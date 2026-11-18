package com.village.population.util

/**
 * 人员字段的中文名。
 *
 * 为什么必须有这一层：数据库里存的是**编码**（`relation = HEAD/SPOUSE/...`），
 * 移动端原先直接把编码贴到界面上，人员详情那一行就成了「与户主关系　HEAD」——
 * 看的人得先知道这套编码才看得懂。
 *
 * 映射表必须与 PC 端保持一致（`frontend/src/views/person/detail.vue` 的 relationLabel、
 * `views/family/index.vue` 的同名函数），否则同一条数据在两端显示不同的字。
 */
object PersonText {

    /**
     * 与户主关系的编码 → 中文，顺序即下拉框顺序（与 PC 的 `utils/format.ts` RELATION_OPTIONS 一致）。
     *
     * ⚠️ 必须是**八项**。这里原先只有五项（少了儿媳女婿 / 孙辈 / 兄弟姐妹），
     * 而 V028 迁移已经把存量数据全部归一到了这八个码上——少一项的后果不是留空，
     * 而是把 `GRANDCHILD` 这样的编码原样贴到界面上（见 [relation] 的 passthrough）。
     */
    val RELATIONS: List<Pair<String, String>> = listOf(
        "HEAD" to "户主",
        "SPOUSE" to "配偶",
        "CHILD" to "子女",
        "CHILD_IN_LAW" to "儿媳女婿",
        "GRANDCHILD" to "孙辈",
        "PARENT" to "父母",
        "SIBLING" to "兄弟姐妹",
        "OTHER" to "其他",
    )

    private val RELATION_MAP: Map<String, String> = RELATIONS.toMap()

    /** 性别编码 → 中文。空值返回空串，未知值原样返回（与 relation 同一原则） */
    fun gender(code: String?): String = when (code?.trim()?.uppercase()) {
        "MALE" -> "男"
        "FEMALE" -> "女"
        null -> ""
        else -> code.trim()
    }

    /**
     * 与户主关系。
     *
     * 认不出的值**原样返回而不是留空**：历史数据里混着中文（Excel 导入时
     * `import_pending.relation` 是「与户主关系原样」，旧版移动端又是自由填写的），
     * 抹成空白会让人以为这条档案坏了；原样显示至少还能看懂。
     */
    fun relation(code: String?): String = passthrough(code, RELATION_MAP)

    /** 人员状态。与 PC 端 utils/personStatus.ts 一致 */
    fun status(code: String?): String = when (code?.trim()?.uppercase()) {
        "NORMAL" -> "正常"
        "MOVED_IN" -> "迁入"
        "MOVED_OUT" -> "迁出"
        "DEAD" -> "死亡"
        null -> ""
        else -> code.trim()
    }

    /**
     * **只在非在册时**给出状态标签，在册（正常 / 迁入 / 未知）一律返回 null。
     *
     * 用于「待核查」列表：那一屏绝大多数行都是正常人口，给每个人都挂一枚徽章会
     * 把真正需要提醒的几行淹没掉。这里只标出「确认入库后不会进在册名单」的那部分。
     */
    fun statusLabel(code: String?): String? = when (code?.trim()?.uppercase()) {
        "MOVED_OUT" -> "已迁出"
        "DEAD" -> "已死亡"
        else -> null
    }

    private fun passthrough(code: String?, map: Map<String, String>): String {
        val v = code?.trim().orEmpty()
        if (v.isEmpty()) return ""
        return map[v.uppercase()] ?: v
    }
}
