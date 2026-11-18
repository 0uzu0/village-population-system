package com.village.population.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 人员字段的中文映射。
 *
 * 这里盯的是**编码泄漏**：映射表少一项时，界面上不会留空，而是把 `GRANDCHILD`
 * 这样的编码原样贴出来（见 PersonText.relation 的 passthrough）——看起来像系统坏了。
 * 后端 V028 已经把所有存量关系归一成八个码，前端的表就必须是八项。
 */
class PersonTextTest {

    @Test
    fun `与户主关系八项齐全，且顺序与 PC 端一致`() {
        assertEquals(
            listOf("HEAD", "SPOUSE", "CHILD", "CHILD_IN_LAW", "GRANDCHILD", "PARENT", "SIBLING", "OTHER"),
            PersonText.RELATIONS.map { it.first },
        )
    }

    @Test
    fun `孙辈与儿媳女婿不再是裸编码`() {
        assertEquals("孙辈", PersonText.relation("GRANDCHILD"))
        assertEquals("儿媳女婿", PersonText.relation("CHILD_IN_LAW"))
        assertEquals("兄弟姐妹", PersonText.relation("SIBLING"))
    }

    @Test
    fun `认不出的关系原样返回，不抹成空白`() {
        // Excel 导入的历史数据里混着中文，抹掉会让人以为档案坏了
        assertEquals("妻", PersonText.relation("妻"))
        assertEquals("", PersonText.relation(null))
    }

    @Test
    fun `性别编码转中文`() {
        assertEquals("男", PersonText.gender("MALE"))
        assertEquals("女", PersonText.gender("FEMALE"))
        assertEquals("", PersonText.gender(null))
    }
}
