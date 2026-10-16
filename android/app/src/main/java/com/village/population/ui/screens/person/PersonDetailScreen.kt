package com.village.population.ui.screens.person

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.village.population.data.remote.dto.PersonDto
import com.village.population.data.repository.PersonRepository
import com.village.population.ui.components.AppTopBar
import com.village.population.ui.components.DotLabel
import com.village.population.ui.components.ErrorBox
import com.village.population.ui.components.InfoRow
import com.village.population.ui.components.LoadingBox
import com.village.population.ui.components.OfflineBanner
import com.village.population.ui.components.SectionCard
import com.village.population.ui.components.parseHexColor
import com.village.population.util.DateText
import com.village.population.util.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import androidx.compose.material.icons.filled.Call
import com.village.population.util.dial

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
    val vm: PersonDetailViewModel = com.village.population.ui.containerViewModel {
        PersonDetailViewModel(it.personRepository, personId)
    }
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(personId) { vm.load() }

    Scaffold(
        topBar = {
            AppTopBar(
                title = state.person?.name ?: "人员详情",
                onBack = onBack,
                actions = {
                    state.person?.let { person ->
                        if (person.phone?.isNotBlank() == true) {
                            IconButton(onClick = { context.dial(person.phone) }) {
                                Icon(Icons.Filled.Call, contentDescription = "拨打电话")
                            }
                        }
                        IconButton(onClick = onCapture) {
                            Icon(Icons.Filled.PhotoCamera, contentDescription = "拍照留痕")
                        }
                        IconButton(onClick = onEdit) {
                            Icon(Icons.Filled.Edit, contentDescription = "编辑")
                        }
                    }
                },
            )
        },
    ) { padding ->
        val person = state.person
        when {
            state.loading && person == null -> LoadingBox(Modifier.padding(padding))
            state.error != null && person == null -> ErrorBox(state.error!!, Modifier.padding(padding)) { vm.load() }
            person == null -> ErrorBox("人员不存在", Modifier.padding(padding))
            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.fromCache) {
                    OfflineBanner("离线缓存数据（${DateText.describeAge(state.savedAt)}）")
                }

                SectionCard(title = "基本信息") {
                    InfoRow("姓名", person.name)
                    InfoRow("性别", if (person.gender == "FEMALE") "女" else "男")
                    InfoRow("出生日期", person.birthDate)
                    InfoRow(
                        "年龄",
                        (person.age ?: DateText.ageOf(person.birthDate))?.let { "$it 岁" },
                    )
                    InfoRow("身份证号", person.idCard)
                    InfoRow("本人电话", person.phone)
                    InfoRow("备用电话", person.phoneBackup)
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

                SectionCard(title = "重点人群标签") {
                    if (person.tags.isEmpty()) {
                        Text(
                            "暂无标签。身份类人群（党员、低保、残疾等）通过打标签认定；" +
                                "老年人、未成年人按出生日期自动判定，不需要打标签。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            person.tags.forEach { tag ->
                                DotLabel(
                                    tag.name,
                                    parseHexColor(tag.color, MaterialTheme.colorScheme.primary),
                                )
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
                        InfoRow("监护人电话", d.guardianPhone)
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
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            }
                        }
                    }
                }

                Text(
                    "数据来源：${person.dataSource ?: "—"}　更新时间：${person.updatedAt ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                Spacer(Modifier.height(24.dp))
            }
        }
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
