# NyaHome

NyaHome 把 Obsidian 的入口收拢成一页：快速搜索、可自由整理的文件夹卡片、时钟、日历与邮箱都在这里。本地功能开箱即用，在线服务按需接入。

NyaHome gathers your Obsidian entry point on one page: quick search, freely arranged folder cards, clock, calendar and mail. Local features work out of the box; connected services are optional.

## 核心功能

- **本地日历**：月 / 周 / 日视图，支持事件创建、编辑与拖拽调整。
- **任务看板**：长期任务管理，支持多看板切换，数据就是普通 Markdown。
- **主页背景**：使用库内图片，透明度和模糊可调。
- **连接服务**：Microsoft、Google、CalDAV、ICS、IMAP 统一收纳，全部可选。
- **邮件与笔记联动**：一键把邮件转成笔记，或生成日历事件。
- **提醒与搜索**：快速定位事件和邮件，不错过重要安排。
- **本地优先**：数据保存在你自己的库里，隐私更可控。

## Core features

- **Local calendar**: month, week and day views; create, edit and drag events.
- **Task boards** for long-term to-dos, multiple boards, plain Markdown files.
- **Home background**: use a vault image with adjustable opacity and blur.
- **Connected services**: Microsoft, Google, CalDAV, ICS and IMAP in one optional tab.
- **Mail meets notes**: turn a message into a note or a calendar event in one click.
- **Search and reminders**: find events and mail fast, so nothing slips by.
- **Local-first**: your data stays in your own vault.

## 本地日历与任务看板

日历是一个库内的 `.ics` 文件，可以直接创建、拖拽、编辑和删除日程，也能导出到其他设备上读取；日历支持自定义背景图片和透明度。任务视图提供类似看板的长期任务管理，每个看板对应库里的一个 Markdown 文件，可以自由切换和整理不同领域的待办事项。

## Local calendar and task boards

The calendar is a plain `.ics` file in your vault — events are created, dragged, edited and deleted directly, and the file can be carried to another machine. Custom background images with adjustable opacity are supported. The task view adds long-term, kanban-style boards backed by ordinary Markdown files, one per board.

## IMAP 邮箱

接入你的 IMAP / SMTP 账号后，邮箱页可以浏览所有账号和文件夹、阅读邮件（含 HTML 正文和附件）、回复转发、写新邮件、搜索和移动邮件。列表和正文会缓存到本地，打开秒出、离线可读；授权码使用 AES-256-GCM 加密存储，密钥保存在本机，不随库同步。

## IMAP mail

Sign in with your IMAP / SMTP credentials and the mail view covers every account and folder: reading (including HTML bodies and attachments), reply and forward, composing with attachments, search and moving messages. Lists and bodies are cached locally, so the view opens instantly and reads offline. Authorization codes are stored AES-256-GCM encrypted; the key never leaves this machine and is not synced with the vault. Desktop only.

## 兼容说明

本插件从早期内部版本整理而来；首次部署会自动迁移原设置和缓存，旧代码块继续可用。

## Compatibility

NyaHome is a new plugin built from the earlier internal edition; the first deploy migrates settings and caches automatically, and old code blocks keep working.

## 开发不易，感谢打赏

如果这个插件对你有帮助，欢迎请作者喝杯咖啡。你的支持会用于后续维护、修 bug 和适配新版本。

If NyaHome helps you, buying the author a coffee is much appreciated — it goes toward maintenance, bug fixes and keeping up with new Obsidian versions.

<p align="center">
  <img src="donate-alipay.jpg" alt="支付宝收款码" width="180">
  <img src="donate-wechat.jpg" alt="微信收款码" width="180">
</p>

> 扫码即可支持开发者，感谢每一份心意。 Scan either QR to support the developer — thank you for every bit of kindness.
