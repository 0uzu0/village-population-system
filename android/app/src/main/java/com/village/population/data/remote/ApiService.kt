package com.village.population.data.remote

import com.village.population.data.remote.dto.AddTagRequest
import com.village.population.data.remote.dto.ApiEnvelope
import com.village.population.data.remote.dto.BatchIdsRequest
import com.village.population.data.remote.dto.ChangePasswordRequest
import com.village.population.data.remote.dto.DashboardDto
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.LedgerCategoryDto
import com.village.population.data.remote.dto.LedgerRecordCreateRequest
import com.village.population.data.remote.dto.LedgerRecordDto
import com.village.population.data.remote.dto.LoginRequest
import com.village.population.data.remote.dto.LoginResponse
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PendingDto
import com.village.population.data.remote.dto.PendingSummaryDto
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.remote.dto.QuickGroupData
import com.village.population.data.remote.dto.SimpleListData
import com.village.population.data.remote.dto.TagDto
import com.village.population.data.remote.dto.UserDto
import com.village.population.data.remote.dto.VillageDto
import com.village.population.data.remote.dto.VoidEnvelope
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/**
 * 与后端 REST 接口一一对应。
 *
 * 移动端**只接现有的 /api 接口**，不为手机端新开后门——同一个鉴权中间件、
 * 同一套权限码，PC 和手机看到的规则完全一致。这样也就不存在「手机能绕过权限」的问题。
 *
 * 有意没有接进来的部分：Excel 导入导出、用户/角色/标签字典管理、审计日志、
 * 家庭批量归户。这些是「坐在电脑前对着大表格」的活，手机屏幕做不了也做不好。
 */
interface ApiService {

    // ---------------- 认证 ----------------

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): ApiEnvelope<LoginResponse>

    @GET("api/auth/me")
    suspend fun me(): ApiEnvelope<UserDto>

    @PUT("api/auth/password")
    suspend fun changePassword(@Body body: ChangePasswordRequest): VoidEnvelope

    // ---------------- 人员 ----------------

    @GET("api/persons")
    suspend fun persons(
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int,
        @Query("keyword") keyword: String? = null,
        @Query("village") village: String? = null,
        @Query("gridId") gridId: Int? = null,
        @Query("gender") gender: String? = null,
        @Query("status") status: String? = null,
        /** "true" / "false" 字符串——后端是 z.enum(['true','false'])，给布尔会解析失败 */
        @Query("activeOnly") activeOnly: String = "true",
        @Query("tagIds") tagIds: String? = null,
        @Query("tagMode") tagMode: String? = null,
        @Query("minAge") minAge: Int? = null,
        @Query("maxAge") maxAge: Int? = null,
        @Query("sortBy") sortBy: String? = null,
        @Query("sortOrder") sortOrder: String? = null,
    ): ApiEnvelope<PageData<PersonDto>>

    @GET("api/persons/{id}")
    suspend fun person(@Path("id") id: Int): ApiEnvelope<PersonDto>

    @POST("api/persons")
    suspend fun createPerson(@Body body: PersonCreateRequest): ApiEnvelope<PersonDto>

    @PUT("api/persons/{id}")
    suspend fun updatePerson(@Path("id") id: Int, @Body body: PersonCreateRequest): ApiEnvelope<PersonDto>

    @POST("api/persons/{id}/tags")
    suspend fun addPersonTag(@Path("id") id: Int, @Body body: AddTagRequest): VoidEnvelope

    @DELETE("api/persons/{id}/tags/{linkId}")
    suspend fun removePersonTag(@Path("id") id: Int, @Path("linkId") linkId: Int): VoidEnvelope

    // ---------------- 网格 / 村庄 ----------------

    @GET("api/grids/villages")
    suspend fun villages(@Query("keyword") keyword: String? = null): ApiEnvelope<SimpleListData<VillageDto>>

    // ---------------- 重点人群 ----------------

    @GET("api/key-groups/quick")
    suspend fun quickGroups(): ApiEnvelope<QuickGroupData>

    // ---------------- 标签 ----------------

    /**
     * 个人标签定义。移动端只用它把重点人群的 `tagCodes` 解析成 `tagIds`
     * （人员列表是按 tagIds 筛的），不做标签字典管理——那是电脑端的活。
     *
     * 需要 `tag:view` 权限：普通用户角色有这个权限（V002 里只有 user/system/audit 三类被排除），
     * 但调用方仍要按「可能失败」来处理，失败时不能把整个工作台带崩。
     */
    @GET("api/tags/definitions")
    suspend fun tagDefinitions(
        @Query("objectType") objectType: String,
        @Query("pageSize") pageSize: Int = 200,
    ): ApiEnvelope<PageData<TagDto>>

    // ---------------- 统计 ----------------

    @GET("api/statistics/dashboard")
    suspend fun dashboard(): ApiEnvelope<DashboardDto>

    // ---------------- 待核查人员 ----------------

    @GET("api/pending")
    suspend fun pendingList(
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int,
        @Query("keyword") keyword: String? = null,
        @Query("status") status: String? = null,
    ): ApiEnvelope<PageData<PendingDto>>

    @GET("api/pending/summary")
    suspend fun pendingSummary(): ApiEnvelope<PendingSummaryDto>

    @POST("api/pending/{id}/confirm")
    suspend fun confirmPending(@Path("id") id: Int, @Body body: Map<String, String> = emptyMap()): VoidEnvelope

    @POST("api/pending/{id}/ignore")
    suspend fun ignorePending(@Path("id") id: Int, @Body body: Map<String, String> = emptyMap()): VoidEnvelope

    @POST("api/pending/batch-ignore")
    suspend fun batchIgnorePending(@Body body: BatchIdsRequest): VoidEnvelope

    // ---------------- 专项台账 ----------------

    @GET("api/ledgers/meta")
    suspend fun ledgerMeta(): ApiEnvelope<List<LedgerCategoryDto>>

    @GET("api/ledgers/records")
    suspend fun ledgerRecords(
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int,
        @Query("category") category: String? = null,
        @Query("workType") workType: String? = null,
        @Query("keyword") keyword: String? = null,
        @Query("startDate") startDate: String? = null,
        @Query("endDate") endDate: String? = null,
    ): ApiEnvelope<PageData<LedgerRecordDto>>

    @POST("api/ledgers/records")
    suspend fun createLedgerRecord(@Body body: LedgerRecordCreateRequest): ApiEnvelope<LedgerRecordDto>

    // ---------------- 附件 ----------------

    /**
     * 上传附件。后端不限大小（nginx 也已放开 client_max_body_size），
     * 唯一闸门是类型白名单：.pdf/.jpg/.jpeg/.png/.webp。
     *
     * 返回的是**单个对象**（不是数组）；biz_type/biz_id 可以先留空，
     * 由业务保存时回填（台账保存时按 created_by 认领本次上传的文件）。
     * 权限是 ledger:manage —— 附件是随台账一起长出来的通用能力。
     */
    @Multipart
    @POST("api/files/upload")
    suspend fun uploadFile(
        @Part file: MultipartBody.Part,
        @Part("bizType") bizType: RequestBody,
        @Part("bizId") bizId: RequestBody,
    ): ApiEnvelope<FileDto>

    /** 下载/预览：必须带 Bearer 头，所以不能直接把 URL 丢给图片控件 */
    @Streaming
    @GET("api/files/{id}")
    suspend fun downloadFile(@Path("id") id: Int): okhttp3.ResponseBody
}
