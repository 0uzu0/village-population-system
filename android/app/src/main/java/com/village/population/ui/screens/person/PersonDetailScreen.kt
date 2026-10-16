package com.village.population.ui.screens.person

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.repository.PersonRepository
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.BottomAction
import com.village.population.ui.components.BottomActionBar
import com.village.population.ui.components.DotLabel
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InfoRow
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.parseHexColor
import com.village.population.ui.theme.AppTheme
import com.village.population.util.DateText
import com.village.population.util.Mask
import com.village.population.util.dial
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PersonDetailUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val person: PersonDto? = null,
    val fromCache: Boolean = false,
    val savedAt: Long = 0L,
    val message: String? = null,
)

class PersonDetailViewModel(
    private val repo: PersonRepository,
    private val personId: Int,
) : ViewModel() {

    private val _state = MutableStateFlow(PersonDetailUiState())
    val state: StateFlow<PersonDetailUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val result = repo.detail(personId)
                _state.update {
                    it.copy(
                        loading = false,
                        person = result.value,
                        fromCache = result.fromCache,
                        savedAt = result.savedAt,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.toUserMessage()) }
            }
        }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }
}

@Composable
fun PersonDetailScreen(
    personId: Int,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onCapture: () -> Unit,
) {
    val context = LocalContext.current
    val tokens = AppTheme.tokens
    val vm: PersonDetailViewModel = com.village.population.ui.containerViewModel {
        PersonDetailViewModel(it.personRepository, personId)
    }
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(personId) { vm.load() }

    val person = state.person

    Scaffold(
        topBar = {
            // 标题用固定的「人员详情」而不是人名：人名就在下面第一张卡片上，
            // 页头再写一遍会挤掉返回键右侧的空间，滚动时也没有额外信息量
            AppTopBar(title = "人员详情", onBack = onBack)
        },
        bottomBar = {
            if (person != null) {
                // 操作栏固定底部（设计稿画法）：单手可及，比原先挤在右上角的三个小图标好按
                val actions = buildList {
                    if (person.phone?.isNotBlank() == true) {
                        add(BottomAction("打电话", Icons.Filled.Call) { context.dial(person.phone) })
                    }
                    add(BottomAction("拍照留痕", Icons.Filled.PhotoCamera, onCapture))
                    add(BottomAction("编辑资料", Icons.Filled.Edit, onEdit))
                }
                BottomActionBar(actions)
            }
        },
    ) { padding ->
        when {
            state.loading && person == null -> LoadingBox(Modifier.padding(padding))
            state.error != null && person == null -> ErrorBox(state.error!!, Modifier.padding(padding)) { vm.load() }
            person == null -> ErrorBox("人员不存在", Modifier.padding(padding))
            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                if (state.fromCache) {
                    OfflineBanner("离线缓存数据（${DateText.describeAge(state.savedAt)}）")
                }

                // 身份卡（设计稿首页那张卡）：头像 + 姓名 + 状态 + 一行摘要
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .background(tokens.brandLight, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Person,
                                contentDescription = null,
                                tint = tokens.brandStrong,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    person.name,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = tokens.ink,
                                )
                                Spacer(Modifier.width(6.dp))
                                val (statusText, statusColor) = statusTag(person.status)
                                DotLabel(statusText, statusColor)
                            }
                            Text(
                                listOfNotNull(
                                    if (person.gender == "FEMALE") "女" else "男",
                                    (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" },
                                    person.village?.takeIf { it.isNotBlank() },
                                    person.gridName?.takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.ink3,
                            )
                        }
                    }
                }

                SectionCard(title = "基本信息") {
                    InfoRow("身份证号", Mask.idCard(person.idCard))
                    InfoRow("本人电话", Mask.phone(person.phone))
                    InfoRow("备用电话", Mask.phone(person.phoneBackup))
                    InfoRow("出生日期", person.birthDate)
                    InfoRow("年龄", (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" })
                    InfoRow("人员编号", person.personNo)
                    InfoRow("人员状态", statusLabel(person.status))
                }

                SectionCard(title = "户籍与居住") {
                    InfoRow("所属村庄", person.village)
                    InfoRow("所属网格", person.gridName)
                    InfoRow("户籍地址", person.hukouAddress)
                    InfoRow("现居住地址", person.liveAddress)
                    InfoRow("与户主关系", person.relation)
                }

                SectionCard(title = "家庭") {
                    InfoRow("所属家庭", person.familyName)
                    InfoRow("与户主关系", person.relation)
                }

                SectionCard(title = "重点人群") {
                    if (person.tags.isEmpty()) {
                        Text(
                            "暂无标签。身份类人群（党员、低保、残疾等）通过打标签认定；" +
                                "老年人、未成年人按出生日期自动判定，不需要打标签。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.ink3,
                        )
                    } else {
                        PersonTags(person)
                    }
                }

                SectionCard(title = "服务台账") {
                    InfoRow("银行账号", person.bankAccount)
                    InfoRow("月补贴金额", person.subsidyAmount?.let { "$it 元/月" })
                    InfoRow("家庭情况", person.familyCondition)
                    InfoRow("健康评估", person.healthAssessment)
                }

                person.disability?.let { d ->
                    SectionCard(title = "残疾档案") {
                        InfoRow("残疾类别", d.type)
                        InfoRow("残疾等级", d.levelLabel ?: d.level)
                        InfoRow("残疾证号", d.card)
                        InfoRow("监护人", d.guardianName)
                        InfoRow("监护人电话", Mask.phone(d.guardianPhone))
                        InfoRow("备注", d.remark)
                    }
                }

                SectionCard(title = "备注") {
                    Text(
                        person.remark?.takeIf { it.isNotBlank() } ?: "—",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }

                if (person.changes.isNotEmpty()) {
                    SectionCard(title = "变更记录（最近 ${person.changes.size} 条）") {
                        person.changes.forEach { change ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Text(
                                    "${change.fieldName ?: "字段"}：${change.oldValue ?: "空"} → ${change.newValue ?: "空"}",
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    listOfNotNull(
                                        change.changeType,
                                        change.reason,
                                        change.createdAt,
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ink3,
                                )
                            }
                        }
                    }
                }

                Text(
                    "数据来源：${person.dataSource ?: "—"}　更新时间：${person.updatedAt ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.ink3,
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

/**
 * 标签区：色片 + 「生效/状态」两列。
 *
 * 用 FlowRow 而不是 Row：一个人身上挂六七个标签是常事（低保 + 残疾 + 老年…），
 * 单行的 Row 会把超出部分直接切掉——患者看不到自己已经被打过的标签，
 * 会以为没登记上，然后重复打一遍。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonTags(person: PersonDto) {
    val tokens = AppTheme.tokens
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        person.tags.forEach { tag ->
            DotLabel(tag.name, parseHexColor(tag.color, tokens.brand))
        }
    }
    Spacer(Modifier.height(8.dp))
    person.tags.forEach { tag ->
        InfoRow(
            tag.name,
            listOfNotNull(
                tag.effectDate?.let { "生效 $it" },
                tag.status?.takeIf { it != "ACTIVE" }?.let { "状态 $it" },
            ).joinToString("，").ifBlank { "有效" },
        )
    }
}

/** 状态中文名，与 PC 端 utils/personStatus.ts 保持一致 */
private fun statusLabel(status: String): String = when (status) {
    "NORMAL" -> "正常"
    "MOVED_IN" -> "迁入"
    "MOVED_OUT" -> "迁出"
    "DEAD" -> "死亡"
    else -> status
}

/** 状态徽标：在册给绿色，迁出/死亡给中性或红色——一眼能看出这个人还算不算在册数里 */
@Composable
private fun statusTag(status: String): Pair<String, androidx.compose.ui.graphics.Color> {
    val tokens = AppTheme.tokens
    return when (status) {
        "NORMAL", "MOVED_IN" -> "在册" to tokens.green
        "DEAD" -> "已死亡" to tokens.red
        else -> "已迁出" to tokens.ink3
    }
}
