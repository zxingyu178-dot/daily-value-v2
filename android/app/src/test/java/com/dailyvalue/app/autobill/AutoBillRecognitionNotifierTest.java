package com.dailyvalue.app.autobill;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Daily Value 2.21.1 - AutoBillRecognitionNotifier 生命周期决策测试（JVM，纯函数）
 * AUTOBILL-NOTICE-01：candidateCount=0 → cancel
 * AUTOBILL-NOTICE-02：ack 最后一条后（count=0）→ cancel
 * AUTOBILL-NOTICE-03：关闭提醒 → 已有 Summary cancel
 * 注：实际 Notification 展示/取消依赖 Android 系统，由真机验证；
 * 本测试锁定「何时展示 / 何时取消」的判定逻辑（与未打开的纯函数一致）。
 */
public class AutoBillRecognitionNotifierTest {

    @Test
    public void notice_show_whenCountPositiveNoticeOnAndCanPost() {
        // candidateCount>0 且提醒开启 且 权限允许 → 展示/更新
        assertTrue(AutoBillRecognitionNotifier.shouldShowSummary(1, true, true));
        assertTrue(AutoBillRecognitionNotifier.shouldShowSummary(3, true, true));
        assertFalse(AutoBillRecognitionNotifier.shouldShowSummary(0, true, true));
    }

    @Test
    public void notice_notshow_whenNoticeOffOrNoPermission() {
        assertFalse(AutoBillRecognitionNotifier.shouldShowSummary(3, false, true));  // 提醒关闭
        assertFalse(AutoBillRecognitionNotifier.shouldShowSummary(3, true, false));  // 无通知权限
        assertFalse(AutoBillRecognitionNotifier.shouldShowSummary(0, false, false));
    }

    @Test
    public void notice_cancel_whenCountZero() {
        // AUTOBILL-NOTICE-01：candidateCount=0（从未有候选 / 全部 ack 掉）→ cancel
        assertTrue(AutoBillRecognitionNotifier.shouldCancelSummary(0, true));
        assertTrue(AutoBillRecognitionNotifier.shouldCancelSummary(0, false));
        assertFalse(AutoBillRecognitionNotifier.shouldCancelSummary(2, true));
    }

    @Test
    public void notice_cancel_whenNoticeToggledOff() {
        // AUTOBILL-NOTICE-03：关闭提醒（即使候选仍在）→ cancel 已有 Summary
        assertTrue(AutoBillRecognitionNotifier.shouldCancelSummary(3, false));
    }

    @Test
    public void notice_ackLastOne_thenCancel() {
        // AUTOBILL-NOTICE-02：候选逐条 ack（3→2→1），直到最后一条（count=0）才 cancel
        assertFalse(AutoBillRecognitionNotifier.shouldCancelSummary(3, true));
        assertFalse(AutoBillRecognitionNotifier.shouldCancelSummary(2, true));
        assertFalse(AutoBillRecognitionNotifier.shouldCancelSummary(1, true));
        assertTrue(AutoBillRecognitionNotifier.shouldCancelSummary(0, true)); // ack 完最后一条 → cancel
    }
}