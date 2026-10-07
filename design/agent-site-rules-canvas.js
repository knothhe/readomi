/* Implemented compact single-panel flow; real-site behavior awaits user verification. */
window.READOMI_CANVAS = {
  "title": "Readomi · 网页单面板站点适配",
  "boards": [
    { "file": "Page-Site-Rule-Saved-Undone.html", "title": "保存提示 · B · 撤销成功 · 3 秒后消失", "x": 2720, "y": 7100, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-Manage-Hover.html", "title": "保存提示 · B · 查看站点规则悬停 · 无底块", "x": 1360, "y": 7100, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-Undo-Hover.html", "title": "保存提示 · B · 撤销悬停 · 无底块", "x": 0, "y": 7100, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-A.html", "title": "保存提示 · A · 一行轻提示", "x": 0, "y": 6000, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-B.html", "title": "保存提示 · B · 紧凑小卡片", "x": 1360, "y": 6000, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-C.html", "title": "保存提示 · C · 深色分区条", "x": 2720, "y": 6000, "w": 1280, "h": 900 },
    { "file": "Page-Site-Rule-Saved-Exiting.html", "title": "保存提示 · Motion 退场 · 中间帧", "x": 2800, "y": 4750, "w": 1280, "h": 900 },
    { "file": "Site-Rule-Saved-Review.html", "title": "保存提示 · 三版对比 · Motion 交互预览", "x": 0, "y": 4750, "w": 1360, "h": 1040 },
    { "file": "Page-Site-Rule-Saved-Dismissed.html", "title": "保存提示 · 消失后 · 规则继续生效", "x": 1440, "y": 4750, "w": 1280, "h": 900 },
    {
      "file": "Page-Site-Rule-Prepare.html",
      "title": "站点适配 · 准备 · 自动读取网站与复制指令",
      "x": 0,
      "y": 150,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Preview-Reddit.html",
      "title": "站点适配 · 预览 · Reddit · 直接保存",
      "x": 1360,
      "y": 150,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Preview-Threads.html",
      "title": "站点适配 · 预览 · Threads · 正文排版待补充",
      "x": 2720,
      "y": 150,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Saved.html",
      "title": "站点适配 · 保存 · 面板收起 · toast 撤销与查看规则",
      "x": 4080,
      "y": 150,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Invalid.html",
      "title": "站点适配 · 候选无效 · 错误定位与保留输入",
      "x": 0,
      "y": 1300,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Preview-Blocked.html",
      "title": "站点适配 · 预览失败 · 当前未匹配到正文",
      "x": 1360,
      "y": 1300,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Conflict.html",
      "title": "站点适配 · 相关规则冲突 · 重新读取",
      "x": 2720,
      "y": 1300,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Save-Failed.html",
      "title": "站点适配 · 保存失败 · 预览仍保留",
      "x": 4080,
      "y": 1300,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Paused.html",
      "title": "站点适配 · 离站暂停 · 返回目标网站",
      "x": 0,
      "y": 2450,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Restoring.html",
      "title": "站点适配 · 刷新恢复 · 禁止提前保存",
      "x": 1360,
      "y": 2450,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Undo-Conflict.html",
      "title": "站点适配 · 撤销冲突 · 保留后来修改",
      "x": 2720,
      "y": 2450,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Settings-Site-Rules-Custom-Saved.html",
      "title": "站点适配 · 长期管理 · 启停 / 复制 / 删除",
      "x": 4080,
      "y": 2450,
      "w": 1280,
      "h": 900
    },
    {
      "file": "Page-Site-Rule-Preview-Mobile.html",
      "title": "站点适配 · 窄屏 · 折叠预览条与停止",
      "x": 0,
      "y": 3600,
      "w": 390,
      "h": 844
    },
    {
      "file": "Popup-Site-Rule-Agent.html",
      "title": "站点适配 · 弹窗 · 当前网站适配入口",
      "x": 1360,
      "y": 3600,
      "w": 320,
      "h": 600
    }
  ],
  "notes": [
    {
      "text": "当前方案：复制 agent 指令 → 最新候选自动提交或备用粘贴 → 网页预览 → 保存。JSON 与诊断放在更多；保存后收起，toast 可撤销。",
      "x": 0,
      "y": 10,
      "maxW": 5200
    },
    {
      "text": "候选或基础规则变化时，旧预览不能继续保存。所有画面为设计示意，运行效果待用户测试。",
      "x": 0,
      "y": 1180,
      "maxW": 5200
    },
    {
      "text": "恢复与长期管理；设置页只管理已保存规则，适配操作在网页单面板内完成。",
      "x": 0,
      "y": 2330,
      "maxW": 5200
    }
  ]
}
