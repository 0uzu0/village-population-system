package com.village.population.data.remote

import com.village.population.data.remote.dto.AddTagRequest
import com.village.population.data.remote.dto.ApiEnvelope
import com.village.population.data.remote.dto.BatchIdsRequest
import com.village.population.data.remote.dto.ChangePasswordRequest
import com.village.population.data.remote.dto.ChangePasswordResponse
import com.village.population.data.remote.dto.DashboardDto
import com.village.population.data.remote.dto.FileDto
import com.village.population.data.remote.dto.LoginRequest
import com.village.population.data.remote.dto.LoginResponse
import com.village.population.data.remote.dto.PageData
import com.village.population.data.remote.dto.PendingDto
import com.village.population.data.remote.dto.PendingSummaryDto
import com.village.population.data.remote.dto.PersonCreateRequest
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.remote.dto.PersonSaveResult
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
    suspend fun changePassword(@Body body: ChangePasswordRequest): ApiEnvelope<ChangePasswordResponse>

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

    /**
     * 新增人员。
     *
     * 响应是 `PersonSaveResult` 而不是 `PersonDto`：未填身份证号时后端**不建正式
     * 档案**，返回的是 `{ pending: true, pendingId }`（没有 id），这种「没建档但
     * 也没失败」的结果必须由调用方明确区分，否则界面会当成建档成功直接返回列表。
     */
    @POST("api/persons")
    suspend fun createPerson(@Body body: PersonCreateRequest): ApiEnvelope<PersonSaveResult>

    @PUT("api/persons/{id}")
    suspend fun updatePerson(@Path("id") id: Int, @Body body: PersonCreateRequest): ApiEnvelope<PersonSaveResult>

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

    /**
     * 编辑待核查记录（补录 / 修正）。
     *
     * 后端只更新 body 里**出现过的**字段，因此这里用 Map 按需组装，
     * 不用固定 data class——界面上没动的字段就不该被发过去，
     * 否则会把别人的正确数据覆盖成空串。
     * 已入库（RESOLVED）的记录后端返回 409。
     */
    @PUT("api/pending/{id}")
    suspend fun updatePending(@Path("id") id: Int, @Body body: Map<String, String?>): VoidEnvelope

    @POST("api/pending/{id}/confirm")
    suspend fun confirmPending(@Path("id") id: Int, @Body body: Map<String, String> = emptyMap()): VoidEnvelope

    @POST("api/pending/{id}/ignore")
    suspend fun ignorePending(@Path("id") id: Int, @Body body: Map<String, String> = emptyMap()): VoidEnvelope

    @POST("api/pending/batch-ignore")
    suspend fun batchIgnorePending(@Body body: BatchIdsRequest): VoidEnvelope

    // ---------------- 附件 ----------------

    /**
     * 上传附件。后端不限大小（nginx 也已放开 client_max_body_size），
     * 唯一闸门是类型白名单：.pdf/.jpg/.jpeg/.png/.webp。
     *
     * 现场照片三个字段必须一起给，缺一个都会留下问题：
     *  · bizType + bizId —— 照片挂在谁身上。缺了就是查不到的孤儿附件；
     *  · capturedAt      —— 拍照时间（epoch 毫秒）。后端**以它命名文件**，
     *                       并以它排序。离线补传时不传，文件名就会变成补传时刻，
     *                       「哪天去谁家拍的」这条线索就丢了。
     * 三者都可空，因为 PC 台账是「先传附件、保存记录时再认领」，那条路径不带这些字段。
     *
     * 权限跟随归属对象：PERSON → person:edit（或台账权限），LEDGER → ledger:manage。
     */
    @Multipart
    @POST("api/files/upload")
    suspend fun uploadFile(
        @Part file: MultipartBody.Part,
        @Part("bizType") bizType: RequestBody,
        @Part("bizId") bizId: RequestBody,
        @Part("capturedAt") capturedAt: RequestBody,
    ): ApiEnvelope<FileDto>

    /** 某个人员 / 台账名下的附件列表（人员详情的「现场照片」区走这里） */
    @GET("api/files")
    suspend fun files(
        @Query("bizType") bizType: String,
        @Query("bizId") bizId: Int,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 100,
    ): ApiEnvelope<PageData<FileDto>>

    /** 下载/预览：必须带 Bearer 头，所以不能直接把 URL 丢给图片控件 */
    @Streaming
    @GET("api/files/{id}")
    suspend fun downloadFile(@Path("id") id: Int): okhttp3.ResponseBody

    /**
     * 删除附件。后端会**连同磁盘上的文件一起删**，且只允许本人上传或管理员操作。
     * 返回体是 `{code:0,message:"文件已删除",data:{id}}`，data 不用读，走 VoidEnvelope。
     */
    @DELETE("api/files/{id}")
    suspend fun deleteFile(@Path("id") id: Int): VoidEnvelope
}
