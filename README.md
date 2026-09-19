# AmberNyaDesk

一款把「本地日历」和「IMAP 邮箱」搬进 Obsidian 的插件：无需离开笔记库，就能查看日程、管理事件、收发邮件，让待办、笔记和邮件在同一条工作流里自然衔接。

A local calendar and an IMAP mailbox, inside Obsidian: schedules, events, task boards and mail without ever leaving your vault.

## 核心功能

- **本地日历**：月 / 周 / 日视图，支持事件创建、编辑与拖拽调整。
- **多日历管理**：工作、生活、项目分开归类，颜色一目了然。
- **任务看板**：长期任务管理，支持多看板切换，数据就是普通 Markdown。
- **IMAP 邮箱**：接入常用邮箱（QQ、163、学校邮箱等），在 Obsidian 内直接收信、读信、写邮件。
- **邮件与笔记联动**：一键把邮件转成笔记，或生成日历事件。
- **提醒与搜索**：快速定位事件和邮件，不错过重要安排。
- **本地优先**：数据保存在你自己的库里，隐私更可控。

## Core features

- **Local calendar**: month, week and day views; create, edit and drag events.
- **Multiple calendars** for work, life and projects, each with its own color.
- **Task boards** for long-term to-dos, multiple boards, plain Markdown files.
- **IMAP mail**: connect your accounts (QQ, 163, school mail and more) and read, write and send mail inside Obsidian.
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

本插件基于 Power Desk（formerly Power Calendar）二次开发，原设置会自动迁移，旧代码块继续可用。

## Compatibility

AmberNyaDesk is built on Power Desk (formerly Power Calendar); settings migrate automatically and old code blocks keep working.

## 开发不易，感谢打赏

如果这个插件对你有帮助，欢迎请作者喝杯咖啡。你的支持会用于后续维护、修 bug 和适配新版本。

If AmberNyaDesk helps you, buying the author a coffee is much appreciated — it goes toward maintenance, bug fixes and keeping up with new Obsidian versions.

<p align="center">
  <img src="donate-alipay.jpg" alt="支付宝收款码" width="180">
  <img src="donate-wechat.jpg" alt="微信收款码" width="180">
</p>

> 扫码即可支持开发者，感谢每一份心意。 Scan either QR to support the developer — thank you for every bit of kindness.
