<script setup lang="ts">
import { t } from '../i18n'
import { regionalAccess } from '../state'
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">WQ CALENDAR GUIDE</p><h1>{{ t("成员使用指南") }}</h1><p class="subtitle">{{ t("WQ 日历集中提供会议日历、回放、重要事项和排行榜。下面按主导航顺序介绍常用操作。") }}</p></div></div>

  <div class="guide-list">
    <section class="card card-body guide-step">
      <span class="guide-number">1</span>
      <div class="detail-copy"><h2>{{ t("使用会议日历") }}</h2><p>{{ t("进入“会议日历”，可在“即将开始”和“历史会议”之间切换，并使用议程或月历浏览。支持按关键词、类别、语言和会议形式筛选；页面中的会议时间统一显示为北京时间。") }}</p><p>{{ t("点击“立即注册”会直接打开外部注册页面；“查看详情”用于确认会议状态和完整信息。即将开始的周期会议在议程中只显示最近一场，历史会议则保留过去 180 天内的每个场次。历史场次只有存在已发布回放时才提供“查看回放”。") }}</p><p>{{ t("成员也可以点击“投稿会议”提交标题、类别、语言、注册链接、北京时间和持续时长，审核通过后才会公开。") }}</p><RouterLink class="button" to="/?submit=1">{{ t("打开会议日历") }}</RouterLink></div>
    </section>

    <section v-if="regionalAccess" class="card card-body guide-step">
      <span class="guide-number">2</span>
      <div class="detail-copy"><h2>{{ t("浏览与贡献回放") }}</h2><p>{{ t("进入“回放”可以查看已经审核的会议回放来源，并按会议场次筛选。同一场会议允许多名成员补充不同的 HTTPS 网盘链接、提取码和简短备注。") }}</p><p>{{ t("遇到链接失效、提取码错误或内容不符时，可在来源卡片旁提交反馈；网站只保存链接信息，不保存视频文件，也不会主动访问网盘内容。") }}</p><RouterLink class="button secondary" to="/replays">{{ t("打开回放") }}</RouterLink></div>
    </section>

    <section class="card card-body guide-step">
      <span class="guide-number">3</span>
      <div class="detail-copy"><h2>{{ t("查看与投稿重要事项") }}</h2><p>{{ t("“重要事项”通过时间线和月历集中展示 PPA 主题、比赛主题和奖金日程，历史记录及已取消事项仍会保留。日期均为北京时间下的全天日期，范围的结束日期包含当天。") }}</p><p>{{ t("成员可以使用基础 Markdown 投稿 PPA 或比赛内容；奖金卡片显示适用周期，但月历只在公布日期和账单日期显示，由管理员维护。重要事项投稿同样需要审核通过后才会公开。") }}</p><RouterLink class="button secondary" to="/important-items">{{ t("打开重要事项") }}</RouterLink></div>
    </section>

    <section class="card card-body guide-step">
      <span class="guide-number">4</span>
      <div class="detail-copy"><h2>{{ t("查看投稿审核结果") }}</h2><p>{{ t("“我的投稿”分别记录会议、回放和重要事项投稿。可以查看待审核、已发布、未通过、已取消或已下架等状态，以及管理员留下的审核反馈。") }}</p><p>{{ t("待审核内容不会进入公开页面；修改内容时需要重新提交，由管理员继续审核。") }}</p><RouterLink class="button secondary" to="/submissions">{{ t("查看我的投稿") }}</RouterLink></div>
    </section>

    <section v-if="regionalAccess" class="card card-body guide-step">
      <span class="guide-number">5</span>
      <div class="detail-copy"><h2>{{ t("查看排行榜与贡献者身份") }}</h2><p>{{ t("“排行榜”分别统计会议投稿、回放贡献和重要事项投稿，展示投稿数、通过数和通过率。管理员账号不参与成员排行。") }}</p><p>{{ t("完整 WQ_ID 默认显示在排行榜和回放来源卡片。可在“设置”中关闭公开显示；关闭后普通成员只能看到开头两个字母，管理员仍可查看完整 ID。") }}</p><RouterLink class="button secondary" to="/leaderboard">{{ t("打开排行榜") }}</RouterLink></div>
    </section>

    <section class="card card-body guide-step">
      <span class="guide-number">6</span>
      <div class="detail-copy"><h2>{{ t("订阅个人日历与设置提醒") }}</h2><p>{{ t("进入“设置”，分别选择是否同步会议、PPA、比赛和奖金日程；四类内容默认全部开启。然后生成个人订阅地址，并在 Google、Outlook 或 Apple Calendar 中通过 URL 添加订阅。") }}</p><p>{{ t("只有会议会按“不提醒、提前 10 分钟、30 分钟、1 小时或 1 天”的设置写入提醒。PPA、比赛和奖金日程只同步日期，始终不写入提醒；日历客户端仍可能应用用户自己的默认提醒。") }}</p><p>{{ t("订阅地址相当于个人访问凭证，请勿转发。生成新地址、旋转或撤销后，旧地址立即失效；实际刷新时间由日历客户端决定。") }}</p><RouterLink class="button secondary" to="/calendar-settings">{{ t("打开成员设置") }}</RouterLink></div>
    </section>

    <section class="card card-body detail-copy guide-tips">
      <h2>{{ t("使用提示") }}</h2>
      <ul>
        <li>{{ t("单场会议可在详情页下载 .ics，也可直接添加到 Google Calendar。") }}</li>
        <li>{{ t("PPA 和比赛的完整日期范围会进入私人订阅；奖金只同步已填写的公布日期和账单日期。") }}</li>
        <li>{{ t("重要事项的 Markdown 仅支持基础文字排版和绝对 HTTPS 链接，不支持图片、视频、表格或原始 HTML。") }}</li>
        <li>{{ t("成员使用 WQ_ID 与日历站点密码登录，不代表官方身份认证。初始密码为 WQ_ID，请登录后尽快在“设置”修改；忘记密码可联系日历管理员。") }}</li>
        <li>{{ t("请勿在会议、重要事项或回放投稿中填写密码、个人专属链接、内部文件或其他敏感内容。") }}</li>
      </ul>
    </section>
  </div>
</template>
