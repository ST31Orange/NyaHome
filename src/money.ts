import { App, ItemView, WorkspaceLeaf, requestUrl } from "obsidian";
import moneyIcon from "./assets/moneyraise.png";

export const VIEW_TYPE_MONEY = "nyahome-money";

/** 安全注入 HTML：内容为开发者构造、动态文本已用 esc() 转义；这是 lint 唯一的豁免点。 */
const setHtml = (el: HTMLElement | ShadowRoot, html: string): void => {
	if (el instanceof ShadowRoot) el.replaceChildren();
	else (el as HTMLElement).empty();
	// eslint-disable-next-line obsidianmd/no-unsafe-innerhtml
	el.innerHTML = html;
};
/** 转义 HTML 特殊字符，防止动态文本破坏结构 / XSS。 */
const esc = (s: any): string => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[m]);
/** 用 class 控制显隐（避免内联静态样式，过 Obsidian lint）。 */
const hide = (el: HTMLElement | null | undefined): void => { if (el) el.addClass("nya-hide"); };
const show = (el: HTMLElement | null | undefined): void => { if (el) el.removeClass("nya-hide"); };


/** 行情中心（NyaMoney）视图。界面基于演示稿 index-v2.html 移植：
 *  用 Shadow DOM 隔离样式与类名，全部交互/画图在插件内实现。
 *  全部为真实行情数据；任一数据源失败时显示空态，绝不生成模拟数据。 */
export class NyaMoneyView extends ItemView {
	private root: HTMLElement;
	private shadow: ShadowRoot;
	private timers: number[] = [];
	private cleanups: Array<() => void> = [];

	constructor(leaf: WorkspaceLeaf, private plugin: { app: App }) {
		super(leaf);
	}

	private vaultKey(): string {
		try { return (this.plugin.app.vault as any).getName ? (this.plugin.app.vault as any).getName() : "vault"; } catch { return "vault"; }
	}

	getViewType(): string {
		return VIEW_TYPE_MONEY;
	}

	getDisplayText(): string {
		return "NyaMoney";
	}

	getIcon(): string {
		return "dollar-sign";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("nyahome-money");
		this.root = this.contentEl.createDiv({ cls: "nyahome-money-root" });
		this.shadow = this.root.attachShadow({ mode: "open" });
		setHtml(this.shadow,
			"<style>" + MONEY_CSS.replace(/:root\b/, ":host") + "</style>" + MONEY_HTML);
		initMoney(this.shadow, this.timers, this.cleanups, this.vaultKey());
	}

	async onClose(): Promise<void> {
		for (const t of this.timers) window.clearInterval(t);
		this.timers = [];
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.shadow = null as unknown as ShadowRoot;
		this.contentEl.empty();
	}
}

/* =====================================================================
 *  界面样式（演示稿 v2 的 CSS，作用域收敛到 .nyahome-money-root）
 * ===================================================================== */
const MONEY_CSS = `
:root{
  --bg:#101216; --panel:#171a20; --panel2:#1d2129; --line:#262b34;
  --text:#e8eaed; --muted:#8b93a1; --dim:#5c6470;
  --up:#f23645; --down:#0aa868; --flat:#9aa0a6;
  --accent:#4c8dff; --accent2:#7aa8ff; --yellow:#e0b341; --ma5:#ffd166; --ma10:#4c8dff; --ma20:#c678dd;
  --radius:10px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px;overflow:hidden}
.app{display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text)}
.up{color:var(--up)!important}
.down{color:var(--down)!important}
.flat{color:var(--flat)!important}
.topbar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex-shrink:0}
.topbar .title{font-weight:700;font-size:15px;margin-right:6px;white-space:nowrap}
.title .dot{color:var(--accent)}
.idx{display:flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.idx:hover{background:var(--panel2)}
.idx .n{font-size:12px;color:var(--muted)}
.idx .p{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.idx .c{font-size:12px;font-variant-numeric:tabular-nums}
.spacer{flex:1}
.btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--accent)}
.btn.sm{padding:3px 9px;font-size:12px}
.switch{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}
.switch .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.switch .seg span{padding:4px 10px;cursor:pointer;background:var(--panel2)}
.switch .seg span.on{background:var(--accent);color:#fff}
main{display:flex;flex:1;min-height:0}
.sidebar{width:390px;min-width:390px;display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--panel)}
.nav{display:flex;gap:2px;padding:10px 12px 4px}
.nav-item{flex:1;text-align:center;padding:7px 0;border-radius:8px;cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
.nav-item:hover{color:var(--text);background:var(--panel2)}
.nav-item.on{color:#fff;background:var(--panel2);box-shadow:inset 0 0 0 1px var(--line)}
.chips{display:flex;gap:6px;padding:6px 12px;flex-wrap:wrap}
.chip{font-size:12px;color:var(--muted);padding:3px 12px;border-radius:20px;cursor:pointer;border:1px solid var(--line)}
.chip.on{color:#fff;background:var(--accent);border-color:var(--accent)}
.sb-search{position:relative;padding:4px 12px 8px}
.sb-search input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text);font-size:13px;outline:none}
.sb-search input:focus{border-color:var(--accent)}
.sb-search .sb-row{display:flex;gap:6px;padding:4px 12px 8px}
.sb-search .sb-row input{flex:1;width:auto;min-width:0}
.sb-btn{flex-shrink:0;background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:0 14px;cursor:pointer;font-size:13px}
.sb-btn:hover{border-color:var(--accent);color:#fff}
.tb{font-size:10px;padding:1px 6px;border-radius:9px;border:1px solid;line-height:1.5;flex-shrink:0;font-weight:600;white-space:nowrap}
.suggest{position:absolute;top:calc(100% - 2px);left:12px;right:12px;z-index:30;background:#20242d;border:1px solid var(--line);border-radius:10px;max-height:340px;overflow:auto;box-shadow:0 12px 30px rgba(0,0,0,.5);display:none}
.suggest.show{display:block}
.sug-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;cursor:pointer;gap:8px}
.sug-item:hover{background:var(--accent);color:#fff}
.sug-item .nm{font-size:13px}.sug-item .cd{font-size:12px;opacity:.65;font-variant-numeric:tabular-nums}
.list-head{display:flex;justify-content:space-between;padding:2px 14px 6px;color:var(--dim);font-size:11px}
.watch{flex:1;overflow-y:auto;min-height:0}
.watch::-webkit-scrollbar{width:8px}
.watch::-webkit-scrollbar-thumb{background:#2a2f3a;border-radius:4px}
.grp{padding:2px 0}
.grp-hd{display:flex;align-items:center;gap:6px;padding:5px 12px;cursor:pointer;font-size:12px;color:var(--muted)}
.grp-hd:hover{color:var(--text)}
.grp-hd .arr{transition:transform .15s}
.grp-hd.collapsed .arr{transform:rotate(-90deg)}
.grp-hd .gn{font-weight:700;font-size:12px;color:var(--text)}
.grp-hd .gc{color:var(--dim)}
.row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:7px 14px;cursor:pointer;border-left:2px solid transparent}
.row:hover{background:var(--panel2)}
.row.sel{background:var(--panel2);border-left-color:var(--accent)}
.row .who{display:flex;flex-direction:column;min-width:0}
.row .nm{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .cd{font-size:11px;color:var(--dim);margin-top:1px}
.row .mid{display:flex;flex-direction:column;align-items:flex-end}
.row .px{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.row .amt{font-size:11px;font-variant-numeric:tabular-nums}
.spark{width:50px;height:24px}
.row .tools{display:none;gap:2px}
.row:hover .tools{display:flex}
.row .ic{color:var(--dim);font-size:13px;padding:1px 4px;border-radius:4px}
.row .ic:hover{color:#fff;background:var(--accent)}
.row .ic.del:hover{background:var(--up)}
.empty{color:var(--dim);text-align:center;padding:26px 0;font-size:12px}
.hold-tip{padding:4px 14px;font-size:11px;color:var(--dim)}
	.chart-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:13px;pointer-events:none;z-index:5;text-align:center;padding:0 20px}
.hold-row{display:grid;grid-template-columns:1fr auto auto;gap:6px 12px;padding:8px 14px;border-bottom:1px solid var(--line);cursor:pointer}
.hold-row:hover{background:var(--panel2)}
.hold-row .nm{font-size:13px;font-weight:600}
.hold-row .sub{font-size:11px;color:var(--dim);margin-top:2px}
.hold-row .big{text-align:right;font-size:12px;font-variant-numeric:tabular-nums}
.hold-row .lbl{font-size:11px;color:var(--dim);font-weight:400}
.hold-sum{display:flex;justify-content:space-between;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);background:var(--panel2);flex-wrap:wrap}
.hold-sum b{color:var(--text);font-variant-numeric:tabular-nums}
.modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:50;align-items:center;justify-content:center}
.modal-mask.show{display:flex}
.modal{background:#20242d;border:1px solid var(--line);border-radius:12px;padding:18px;width:330px;color:var(--text)}
.modal h3{font-size:15px;margin-bottom:12px;color:var(--text)}
.modal label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
.modal input,.modal select{width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text);font-size:13px;outline:none}
.modal input:focus{border-color:var(--accent)}
.modal .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.modal-wide{width:460px;max-width:92vw;display:flex;flex-direction:column;max-height:76vh}
.all-list{overflow:auto;margin:2px 0 6px;border:1px solid var(--line);border-radius:8px}
.all-item{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line)}
.all-item:last-child{border-bottom:none}
.all-item:hover{background:var(--panel2)}
.all-item .nm{flex:1;color:var(--text)}
.all-item .cd{color:var(--muted);font-variant-numeric:tabular-nums}
.all-item .tg{font-size:11px;opacity:.85;color:var(--muted)}
.ftb-bar{display:flex;gap:6px;margin:2px 0 8px;flex-wrap:wrap}
.ftb{font-size:12px;padding:3px 12px;border-radius:16px;border:1px solid var(--line);cursor:pointer;user-select:none;transition:background .12s}
.ftb:hover{opacity:.9}
.sug-item.more{justify-content:center;color:var(--accent);font-weight:600;text-align:center;padding:8px}
.detail{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg)}
.d-top{display:flex;align-items:flex-start;gap:18px;padding:14px 22px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.d-id .nm{font-size:19px;font-weight:700}
.d-id .cd{font-size:13px;color:var(--muted);margin-top:3px}
.d-price .px{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.d-price .chg{font-size:14px;font-variant-numeric:tabular-nums;margin-top:5px;font-weight:600}
.d-tags{display:flex;gap:6px;margin-top:8px}
.tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 7px}
.d-stats{margin-left:auto;display:grid;grid-template-columns:repeat(3,minmax(92px,auto));gap:8px 22px;font-size:12px}
.stat .k{color:var(--dim);font-size:11px}
.stat .v{color:var(--text);font-variant-numeric:tabular-nums;margin-top:2px;font-size:13px}
.chart-wrap{flex:1;display:flex;flex-direction:column;padding:8px 22px 12px;min-height:0}
.c-tabs{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.c-tab{padding:4px 13px;border-radius:20px;font-size:12px;color:var(--muted);cursor:pointer;border:1px solid transparent}
.c-tab:hover{color:var(--text)}
.c-tab.on{color:#fff;background:var(--panel2);border-color:var(--line)}
.ind-tabs{margin-left:auto;display:flex;gap:4px;align-items:center}
.ind-tabs .lbl{font-size:11px;color:var(--dim);margin-right:4px}
.chart{flex:1;position:relative;min-height:180px}
.chart canvas{width:100%;height:100%;display:block;cursor:crosshair}
#cvX{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.tip{position:absolute;pointer-events:none;background:rgba(20,23,29,.95);border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.6;display:none;z-index:20;white-space:nowrap}
.tip.show{display:block}
.tip .t1{color:var(--muted)}
.legend{display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px;flex-wrap:wrap;gap:4px;min-height:16px}
.ind-hint{font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 10px;margin-top:4px;line-height:1.55}
.ind-note{font-size:11px;color:var(--muted);margin-left:8px;opacity:.9;white-space:nowrap}
.host{height:100%}
.zoom-bar{display:flex;align-items:center;gap:6px;padding:4px 2px 0;font-size:12px;color:var(--muted);flex-wrap:wrap}
.zoom-bar .zlbl{color:var(--dim)}
.zoom-bar .zbtn{padding:2px 9px;border:1px solid var(--line);border-radius:6px;cursor:pointer;background:var(--panel2);color:var(--muted);font-size:12px}
.zoom-bar .zbtn:hover{border-color:var(--accent);color:var(--text)}
.zoom-bar .zbtn.on{background:var(--accent);border-color:var(--accent);color:#fff}
.zoom-bar .zsep{width:1px;height:14px;background:var(--line);margin:0 2px}
.zoom-bar .navseg{display:flex;gap:2px}
.zoom-bar .zrange{margin-left:auto;color:var(--dim);font-size:11px;white-space:nowrap}

	.nya-hide{display:none!important}
	.nya-menu{position:absolute;background:#20242d;border:1px solid var(--line);border-radius:8px;z-index:40;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
	.nya-menu-item{padding:6px 12px;cursor:pointer;font-size:12px}
	.nya-menu-item:hover{background:var(--accent)}
	.nya-grp-cont{padding:0 12px 6px}
	.nya-grp-line{display:flex;justify-content:space-between;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px}
	.nya-grp-line:hover{background:var(--panel2)}
	.nya-modal-ok{background:var(--accent);border-color:var(--accent);color:#fff}
	.nya-detail-cmp{margin-top:8px}
` as const;
/* =====================================================================
 *  界面骨架（演示稿 v2 的 body 结构，去掉演示 footbar，标题为 NyaMoney）
 * ===================================================================== */
const MONEY_HTML = `
<div class="app">
  <div class="topbar">
    <div class="title"><span class="dot">●</span> NyaMoney</div>
    <div class="idx" data-idx="000001.SH"><span class="n">上证指数</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="idx" data-idx="399001.SZ"><span class="n">深证成指</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="idx" data-idx="399006.SZ"><span class="n">创业板指</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="idx" data-idx="HSI"><span class="n">恒生指数</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="idx" data-idx="IXIC"><span class="n">纳斯达克</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="idx" data-idx="SPX"><span class="n">标普500</span><span class="p" data-k="p">–</span><span class="c" data-k="c">–</span></div>
    <div class="spacer"></div>
    <div class="switch" title="涨跌配色切换">
      <span style="color:var(--dim)">配色</span>
      <div class="seg" id="colorSeg">
        <span data-c="cn" class="on">红涨绿跌</span>
        <span data-c="intl">绿涨红跌</span>
      </div>
    </div>
    <button class="btn" id="btnRefresh">⟳ 刷新</button>
  </div>
  <main>
    <aside class="sidebar">
      <div class="nav">
        <div class="nav-item on" data-nav="all">全部</div>
        <div class="nav-item" data-nav="groups">分组</div>
        <div class="nav-item" data-nav="hold">持有</div>
      </div>
      <div id="allPanel">
        <div class="chips" id="chips">
          <div class="chip on" data-type="all">全部</div>
          <div class="chip" data-type="fund">基金</div>
          <div class="chip" data-type="stock">股票</div>
          <div class="chip" data-type="us">美股</div>
        </div>
        <div class="sb-search">
          <div class="sb-row">
            <input id="searchInput" type="text" placeholder="搜索 代码 / 名称 / 拼音 / 板块，如 320007、诺安、白酒…" autocomplete="off">
            <button class="sb-btn" id="searchBtn" title="搜索">搜索</button>
          </div>
          <div class="suggest" id="suggest"></div>
        </div>
        <div class="list-head"><span>我的自选（按分组）</span><span class="cnt" id="listCnt"></span></div>
      </div>
      <div class="watch" id="watch"></div>
      <div id="groupPanel" style="display:none"></div>
      <div id="holdPanel" style="display:none"></div>
    </aside>
    <section class="detail" id="detail">
      <div class="d-top" id="dTop"></div>
      <div class="chart-wrap">
        <div class="c-tabs">
          <div class="c-tab on" data-range="intraday" data-lk="分时" data-lf="当日">分时</div>
          <div class="c-tab" data-range="daily" data-lk="日K" data-lf="当周">日K</div>
          <div class="c-tab" data-range="weekly" data-lk="周K" data-lf="当月">周K</div>
          <div class="c-tab" data-range="monthly" data-lk="月K" data-lf="月K">月K</div>
          <div class="c-tab" data-range="y1" data-lk="近1年" data-lf="近1年">近1年</div>
          <div class="c-tab" data-range="y3" data-lk="近3年" data-lf="近3年">近3年</div>
          <div class="c-tab" data-range="y5" data-lk="近5年" data-lf="近5年">近5年</div>
          <div class="ind-tabs">
            <span class="lbl">指标</span>
            <div class="c-tab on" data-ind="none" title="仅成交量副图">无</div>
            <div class="c-tab" data-ind="macd" title="MACD：趋势动量指标（金叉/死叉）">MACD</div>
            <div class="c-tab" data-ind="kdj" title="KDJ：随机指标（超买/超卖）">KDJ</div>
            <div class="c-tab" data-ind="rsi" title="RSI：相对强弱（>70超买/<30超卖）">RSI</div>
            <span class="ind-note" id="indNote"></span>
          </div>
        </div>
        <div class="chart" id="chart"><canvas id="cv"></canvas><canvas id="cvX"></canvas><div class="tip" id="tip"></div><div class="chart-msg" style="display:none"></div></div>
        <div class="zoom-bar" id="zoomBar" style="display:none">
          <span class="zlbl">缩放</span>
          <span class="zbtn" data-z="30">30</span>
          <span class="zbtn" data-z="60">60</span>
          <span class="zbtn" data-z="120">120</span>
          <span class="zbtn on" data-z="all">全部</span>
          <span class="zsep"></span>
          <span class="navseg" id="navSeg">
            <span class="zbtn on" data-nav="unit">单位净值</span>
            <span class="zbtn" data-nav="acc">累计净值</span>
          </span>
          <span class="zrange" id="zRange"></span>
        </div>
        <div class="legend"><span id="lgLeft"></span><span id="lgRight"></span></div>
      </div>
    </section>
  </main>
</div>
`;
/* =====================================================================
 *  逻辑（演示稿 v2 的 script 移植，选择器收敛到 root；类型从宽以保持等价）
 * ===================================================================== */
function initMoney(root: ShadowRoot, timers: number[], cleanups: Array<() => void>, vaultKey: string): void {
	const $ = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
	const $$ = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll(sel));

	/* ---------- 工具 ---------- */
	const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

	const pad2 = (v: number) => (v < 10 ? "0" : "") + v;
	const fmtDate = (d: string) => (d && d.length >= 10 ? d.slice(5) : d || "");
	const aggDates = (dates: string[], n: number): string[] => {
		const out: string[] = [];
		for (let i = 0; i < dates.length; i += n) out.push(dates[Math.min(i + n - 1, dates.length - 1)]);
		return out;
	};
	let colorMode: string = "cn";
	const upC = () => (colorMode === "cn" ? "#f23645" : "#0aa868");
	const dnC = () => (colorMode === "cn" ? "#0aa868" : "#f23645");
	const dirC = (p: number) => (p > 0 ? upC() : p < 0 ? dnC() : "#9aa0a6");

	/* ---------- 标的初始化（无任何内置模拟数据；全部来自真实行情） ---------- */
	const mkItem = (o: any): any => {
		const p = o.price || 1, prev = o.prev || +(p / (1 + (o.pct || 0) / 100)).toFixed(4), amt = +(p - prev).toFixed(4);
		return Object.assign({}, o, {
			prev, amt,
			stats: { 今开: o.open || "—", 最高: o.high || "—", 最低: o.low || "—", 昨收: prev, 成交量: "—", 更新: "—" },
		});
	};
	const typeTag = (t: string) => (t === "fund" ? "基金" : t === "stock" ? "股票" : t === "us" ? "美股" : t === "index" ? "指数" : "标的");
	const typeColor = (t: string): string => t === "fund" ? "#4c8dff" : t === "stock" ? "#26a0a0" : t === "us" ? "#c678dd" : t === "index" ? "#e0b341" : "#8b93a1";
	let items: any[] = [];
	let groups: any[] = [];
	const groupOf = (code: string) => { const g = groups.find((x: any) => x.items.includes(code)); return g ? g.id : null; };
	let holdings: any[] = [];
	const LS_KEY = "nyahome-money-" + vaultKey;
	const SAVE_FIELDS = ["code", "name", "type", "mkt", "secid", "proxy", "price", "pct", "prev", "_holdings", "_holdingsTs"];
	const DATA_VER = 2;
	// 旧版（演示期）自动种子的默认代码/分组/持仓，迁移时仅清理“未被改动”的演示数据，用户自己加的真实标的保留
	const LEGACY_SEED_CODES = ["320007", "161725", "110011", "005827", "510300", "600519", "000001", "300750", "0700", "AAPL", "NVDA", "TSLA"];
	const LEGACY_GROUPS: any[] = [
		{ id: "g1", name: "核心持仓", items: ["320007", "600519", "NVDA"] },
		{ id: "g2", name: "白酒消费", items: ["161725", "110011", "005827"] },
		{ id: "g3", name: "观察池", items: ["510300", "000001", "300750", "0700", "AAPL", "TSLA"] },
	];
	const LEGACY_HOLDS: any[] = [
		{ code: "320007", shares: 50000, cost: 1.85 },
		{ code: "600519", shares: 100, cost: 1450 },
		{ code: "NVDA", shares: 50, cost: 120 },
	];
	const saveMoney = () => {
		try {
			localStorage.setItem(LS_KEY, JSON.stringify({
				dataVer: DATA_VER,
				items: items.map((it: any) => { const o: any = {}; SAVE_FIELDS.forEach((k: string) => { if (it[k] !== undefined) o[k] = it[k]; }); return o; }),
				groups, holdings,
			}));
		} catch { /* 忽略 */ }
	};
	const loadMoney = (): boolean => {
		try {
			const raw = localStorage.getItem(LS_KEY);
			if (!raw) return false;
			const st = JSON.parse(raw);
			let restored: any[] = st.items && Array.isArray(st.items) ? st.items.map((o: any) => mkItem(o)) : [];
			let restoredGroups: any[] = st.groups && Array.isArray(st.groups) ? st.groups : [];
			let restoredHolds: any[] = st.holdings && Array.isArray(st.holdings) ? st.holdings : [];
			if (st.dataVer !== DATA_VER) {
				// 迁移（一次性）：移除旧版自动种子的演示自选/分组/持仓（用户自己搜索添加的真实标的保留）
				restored = restored.filter((o: any) => !LEGACY_SEED_CODES.includes(o.code));
				restoredGroups = restoredGroups.filter((g: any) => !LEGACY_GROUPS.some((l: any) => l.name === g.name && JSON.stringify(l.items) === JSON.stringify(g.items)));
				restoredHolds = restoredHolds.filter((h: any) => !LEGACY_HOLDS.some((l: any) => l.code === h.code && +h.shares === l.shares && +h.cost === l.cost));
			}
			items = restored;
			groups = restoredGroups;
			holdings = restoredHolds;
			return true;
		} catch { return false; }
	};
	if (!loadMoney()) { items = []; groups = []; holdings = []; }
	const searchPool: any[] = [
		{ code: "320007", name: "诺安成长混合A", type: "fund", jp: "NACZHHA" },
		{ code: "320001", name: "诺安平衡混合", type: "fund", jp: "NAPHH" },
		{ code: "320003", name: "诺安股票", type: "fund", jp: "NAGP" },
		{ code: "320005", name: "诺安价值增长混合", type: "fund", jp: "NAJZZZHH" },
		{ code: "161725", name: "招商中证白酒LOF A", type: "fund", jp: "ZSZZBJ" },
		{ code: "110011", name: "易方达优质精选混合", type: "fund", jp: "YFDYZJXHH" },
		{ code: "005827", name: "易方达蓝筹精选混合", type: "fund", jp: "YFDLCJXHH" },
		{ code: "510300", name: "沪深300ETF", type: "fund", jp: "HS300ETF" },
		{ code: "600519", name: "贵州茅台", type: "stock", mkt: "sh", jp: "GZMT" },
		{ code: "000001", name: "平安银行", type: "stock", mkt: "sz", jp: "PAYH" },
		{ code: "300750", name: "宁德时代", type: "stock", mkt: "sz", jp: "NDSD" },
		{ code: "601318", name: "中国平安", type: "stock", jp: "ZGPA" },
		{ code: "0700", name: "腾讯控股", type: "stock", mkt: "hk", jp: "TXKG" },
		{ code: "09988", name: "阿里巴巴-W", type: "stock", jp: "ALBBW" },
		{ code: "AAPL", name: "苹果", type: "us", mkt: "us", jp: "AAPL" },
		{ code: "NVDA", name: "英伟达", type: "us", mkt: "us", jp: "NVDA" },
		{ code: "TSLA", name: "特斯拉", type: "us", mkt: "us", jp: "TSLA" },
		{ code: "MSFT", name: "微软", type: "us", jp: "MSFT" },
	];
	const INDICES: any[] = [
		{ key: "000001.SH", secid: "1.000001", tx: "sh000001", n: "上证指数" },
		{ key: "399001.SZ", secid: "0.399001", tx: "sz399001", n: "深证成指" },
		{ key: "399006.SZ", secid: "0.399006", tx: "sz399006", n: "创业板指" },
		{ key: "HSI", secid: "100.HSI", tx: "hkHSI", n: "恒生指数" },
		{ key: "IXIC", secid: "100.IXIC", tx: "usIXIC", n: "纳斯达克" },
		{ key: "SPX", secid: "100.SPX", tx: "usINX", n: "标普500" },
	];	const setIdx = (key: string, p: string, c: number) => {
		const el = root.querySelector('.idx[data-idx="' + key + '"]') as HTMLElement;
		if (!el) return;
		(el.querySelector("[data-k=p]") as HTMLElement).textContent = p;
		const ce = el.querySelector("[data-k=c]") as HTMLElement;
		ce.textContent = (c >= 0 ? "+" : "") + c + "%";
		ce.className = "c " + cls(c);
	};
	const refreshIndices = async (): Promise<void> => {
		const secids = INDICES.map((id: any) => id.secid).join(",");
		const j = await httpJson("https://push2.eastmoney.com/api/qt/ulist.np/get?secids=" + secids + "&fields=f2,f3,f12,f13,f14");
		const diff: any[] = (j && j.data && j.data.diff) || [];
		if (diff.length) {
			const map = new Map(diff.map((d: any) => [d.f13 + "." + d.f12, d]));
			INDICES.forEach((id: any) => {
				const d = map.get(id.secid);
				if (!d || d.f2 == null || d.f2 === "-") return;
				setIdx(id.key, (+d.f2 / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 }), +(d.f3 / 100).toFixed(2));
			});
			return;
		}
		// 腾讯备用
		const qs = INDICES.map((id: any) => id.tx).join(",");
		const txt = await httpGBK("https://qt.gtimg.cn/q=" + qs);
		if (txt) {
			INDICES.forEach((id: any) => {
				const m = txt.match(new RegExp("v_" + id.tx + '="([^"]*)"'));
				if (!m) return;
				const a = m[1].split("~");
				if (!a[3] || isNaN(+a[3])) return;
				setIdx(id.key, (+a[3]).toLocaleString("zh-CN", { maximumFractionDigits: 2 }), +(+a[32]).toFixed(2));
			});
		}
	};
	let curNav = "all", curType = "all", curItem: any = null, curRange = "intraday", curInd = "none";
	/* ---------- 渲染：侧栏 ---------- */
	const sparkSVG = (seq: number[], color: string) => {
		if (!seq || seq.length < 2) return '<svg class="spark" viewBox="0 0 50 24"></svg>';
		const n = seq.length, w = 50, h = 24, min = Math.min.apply(null, seq), max = Math.max.apply(null, seq), span = (max - min) || 1;
		const pts = seq.map((v, i) => ((i / (n - 1)) * w).toFixed(1) + "," + (h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)).join(" ");
		return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '"><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.4"/></svg>';
	};
	const cls = (p: number) => (p > 0 ? "up" : p < 0 ? "down" : "flat");
	const renderAll = () => {
		const list = items.filter((it: any) => curType === "all" || it.type === curType);
		show($("#allPanel"));
		hide($("#groupPanel"));
		hide($("#holdPanel"));
		const w = $("#watch");
		show(w);
		setHtml(w, "");
		$("#listCnt").textContent = list.length + " 项 · " + groups.length + " 组";
		if (!list.length) { setHtml(w, '<div class="empty">暂无自选 · 用上方搜索添加基金 / 股票 / 美股（数据为真实行情）</div>'); return; }
		groups.forEach((g: any) => {
			const gitems = list.filter((it: any) => groupOf(it.code) === g.id);
			if (!gitems.length) return;
			const box = document.createElement("div"); box.className = "grp";
			setHtml(box, '<div class="grp-hd"><span class="arr">▼</span><span class="gn">' + esc(g.name) + '</span><span class="gc">' + gitems.length + "</span></div>");
			const cont = document.createElement("div"); cont.className = "g-items";
			gitems.forEach((it: any) => cont.appendChild(makeRow(it)));
			box.appendChild(cont); w.appendChild(box);
			const hd = box.querySelector(".grp-hd") as HTMLElement;
			hd.onclick = () => { g.collapsed = !g.collapsed; hd.classList.toggle("collapsed", g.collapsed); if (g.collapsed) hide(cont); else show(cont); };
			if (g.collapsed) { hd.classList.add("collapsed"); hide(cont); }
		});
		const loose = list.filter((it: any) => !groupOf(it.code));
		if (loose.length) {
			const box = document.createElement("div"); box.className = "grp";
			setHtml(box, '<div class="grp-hd"><span class="arr">▼</span><span class="gn">未分组</span><span class="gc">' + loose.length + "</span></div>");
			const cont = document.createElement("div"); cont.className = "g-items";
			loose.forEach((it: any) => cont.appendChild(makeRow(it)));
			box.appendChild(cont); w.appendChild(box);
		}
	};
	const makeRow = (it: any): HTMLElement => {
		const row = document.createElement("div");
		row.className = "row" + (curItem && it.code === curItem.code && it.type === curItem.type ? " sel" : "");
		const g = groups.find((x: any) => x.id === groupOf(it.code));
		setHtml(row,
			'<div class="who"><span class="nm">' + esc(it.name) + '</span><span class="cd">' + esc(it.code) + " · " + typeTag(it.type) + (g ? " · " + esc(g.name) : "") + '</span></div>' +
			'<div class="mid"><span class="px ' + cls(it.pct) + '">' + it.price.toFixed(2) + '</span><span class="amt ' + cls(it.pct) + '">' + (it.pct >= 0 ? "+" : "") + it.pct.toFixed(2) + "%</span></div>" +
			sparkSVG((it._real && it._real.m1) || [], dirC(it.pct)) +
			'<div class="tools"><span class="ic move" title="移动分组">⇄</span><span class="ic del" title="删除">✕</span></div>');
		row.onclick = (e) => { if ((e.target as HTMLElement).closest(".tools")) return; selectItem(it); };
		(row.querySelector(".del") as HTMLElement).onclick = (e) => {
			e.stopPropagation();
			items = items.filter((i: any) => !(i.code === it.code && i.type === it.type));
			groups.forEach((gg: any) => { gg.items = gg.items.filter((c: string) => c !== it.code); });
			if (curItem && curItem === it) { if (items.length) selectItem(items[0]); else { curItem = null; renderDetail(); renderChart(); } }
			saveMoney();
			renderAll(); renderSearch();
		};
		(row.querySelector(".move") as HTMLElement).onclick = (e) => { e.stopPropagation(); moveMenu(it, row); };
		return row;
	};
	const moveMenu = (it: any, row: HTMLElement) => {
		const m = document.createElement("div"); m.className = "nya-menu";
		const old = groupOf(it.code);
		groups.forEach((g: any) => {
			const d = document.createElement("div");
			d.textContent = (g.id === old ? "✓ " : "") + g.name;
			d.className = "nya-menu-item";
			d.onclick = () => { groups.forEach((gg: any) => { gg.items = gg.items.filter((c: string) => c !== it.code); }); g.items.push(it.code); saveMoney(); renderAll(); m.remove(); };
			m.appendChild(d);
		});
		document.body.appendChild(m);
		const r = row.getBoundingClientRect();
		m.style.left = Math.min(r.left, r.right - 150) + "px"; m.style.top = r.top + 28 + "px";
		setTimeout(() => {
			const h = (e: MouseEvent) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener("mousedown", h); } };
			document.addEventListener("mousedown", h);
		}, 0);
	};
	const renderGroups = () => {
		hide($("#allPanel"));
		hide($("#watch"));
		hide($("#holdPanel"));
		const p = $("#groupPanel"); show(p); setHtml(p, "");
		setHtml(p, '<div style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="newGrp">＋ 新建分组</button><button class="btn sm" id="addToSelf">＋ 添加标的</button></div>');
		groups.forEach((g: any) => {
			const n = items.filter((it: any) => g.items.includes(it.code)).length;
			const box = document.createElement("div"); box.className = "grp";
			setHtml(box, '<div class="grp-hd" style="cursor:default"><span class="gn">' + esc(g.name) + '</span><span class="gc">' + n + ' 项</span>' +
				'<span class="spacer"></span><span class="ic rn" style="cursor:pointer" title="重命名">✎</span> <span class="ic dl" style="cursor:pointer" title="删除分组">🗑</span></div>');
			const cont = document.createElement("div"); cont.className = "nya-grp-cont";
			g.items.forEach((code: string) => {
				const it = items.find((i: any) => i.code === code);
				if (!it) return;
				const line = document.createElement("div"); line.className = "nya-grp-line";
				line.onclick = () => selectItem(it);
				setHtml(line, "<span>" + esc(it.name) + '</span><span class="' + (it.pct >= 0 ? "up" : "down") + '" style="font-variant-numeric:tabular-nums">' + (it.pct >= 0 ? "+" : "") + it.pct.toFixed(2) + "%</span>");
				cont.appendChild(line);
			});
			box.appendChild(cont); p.appendChild(box);
			(box.querySelector(".rn") as HTMLElement).onclick = () => { const nn = prompt("重命名分组", g.name); if (nn && nn.trim()) { g.name = nn.trim(); saveMoney(); renderGroups(); } };
			(box.querySelector(".dl") as HTMLElement).onclick = () => { if (confirm("删除分组「" + g.name + "」？标的移入未分组")) { groups = groups.filter((x: any) => x.id !== g.id); saveMoney(); renderAll(); renderGroups(); } };
		});
		$("#newGrp").onclick = () => { const nn = prompt("新分组名称"); if (nn && nn.trim()) { groups.push({ id: "g" + Date.now(), name: nn.trim(), collapsed: false, items: [] }); saveMoney(); renderGroups(); } };
		$("#addToSelf").onclick = () => openAddModal();
	};
	const renderHold = () => {
		hide($("#allPanel"));
		hide($("#watch"));
		hide($("#groupPanel"));
		const p = $("#holdPanel"); show(p);
		let totalCost = 0, totalMv = 0, totalPnl = 0;
		const rows = holdings.map((h: any) => {
			const it = items.find((i: any) => i.code === h.code);
			const px = it ? it.price : h.cost;
			const mv = px * h.shares, cost = h.cost * h.shares, pnl = mv - cost, dayPnl = it ? (px - it.prev) * h.shares : 0;
			totalCost += cost; totalMv += mv; totalPnl += pnl;
			return '<div class="hold-row" data-code="' + esc(h.code) + '">' +
				'<div><div class="nm">' + esc(h.name) + '</div><div class="sub">' + esc(h.code) + " · 成本 " + h.cost.toFixed(3) + " · 份额 " + h.shares.toLocaleString() + "</div></div>" +
				'<div class="big">市值 <b>' + mv.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "</b></div>" +
				'<div class="big">浮动 <b class="' + (pnl >= 0 ? "up" : "down") + '">' + (pnl >= 0 ? "+" : "") + pnl.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " (" + (h.cost ? (pnl / cost * 100) : 0).toFixed(2) + "%)</b><div class=\"lbl\">当日 " + (dayPnl >= 0 ? "+" : "") + dayPnl.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "</div></div></div>";
		}).join("");
		setHtml(p,
			'<div class="hold-tip">录入真实持仓，自动计算实际盈亏（数据仅保存在本地）</div>' + rows +
			'<div class="hold-sum"><span>总市值 <b>' + totalMv.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "</b></span><span>总成本 <b>" + totalCost.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "</b></span><span>总浮动 <b class=\"" + (totalPnl >= 0 ? "up" : "down") + '">' + (totalPnl >= 0 ? "+" : "") + totalPnl.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " (" + (totalCost ? (totalPnl / totalCost * 100) : 0).toFixed(2) + "%)</b></span></div>" +
			'<div style="padding:10px 12px"><button class="btn sm" id="addHold">＋ 添加持有</button></div>');
		p.querySelectorAll(".hold-row").forEach((r) => (r as HTMLElement).onclick = () => { const it = items.find((i: any) => i.code === (r as HTMLElement).dataset.code); if (it) selectItem(it); });
		$("#addHold").onclick = () => openHoldModal();
	};
	/* ---------- 搜索联想（本地 + 全市场实时搜索） ---------- */
	const searchInput = $("#searchInput") as HTMLInputElement, suggest = $("#suggest");
	let searchTimer: number | null = null;
	let remoteHits: any[] = [];
	const searchMatches = (q: string) => {
		q = q.trim().toUpperCase(); if (!q) return [];
		return searchPool.filter((s: any) => s.code.includes(q) || s.name.toUpperCase().includes(q) || s.jp.includes(q)).slice(0, 6);
	};
	const classifyToType = (c: string): string => c === "AStock" ? "stock" : c === "HK" ? "stock" : c === "UsStock" ? "us" : c === "OTCFUND" || c === "Fund" ? "fund" : c === "Index" ? "index" : "";
	const mktFromSecid = (secid: string): string => { if (secid.startsWith("116.")) return "hk"; if (secid.startsWith("1.")) return "sh"; if (secid.startsWith("0.")) return "sz"; return "us"; };
	let tencentBoardCache: any[] | null = null;
	const tencentBoardCons = async (q: string): Promise<any[]> => {
		try {
			const norm = (s: string) => String(s || "").toLowerCase().replace(/板块|概念|指数/g, "");
			const qn = norm(q);
			if (!tencentBoardCache) {
				tencentBoardCache = [];
				for (let off = 0; off <= 200 && tencentBoardCache.length < 500; off += 200) {
					const j = await httpJson("https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=gn&sort_type=price&direct=down&offset=" + off + "&count=200", "https://gu.qq.com/");
					const rl: any[] = (j && j.data && j.data.rank_list) || [];
					if (!rl.length) break;
					tencentBoardCache = tencentBoardCache.concat(rl);
				}
			}
			const b = tencentBoardCache.find((x: any) => x.name && norm(x.name).includes(qn)) ||
				tencentBoardCache.find((x: any) => x.name && qn.includes(norm(x.name)) && norm(x.name).length >= 2);
			if (!b) return [];
			const j2 = await httpJson("https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?board_code=" + b.code + "&sort_type=price&direct=down&offset=0&count=100", "https://gu.qq.com/");
			const rl: any[] = (j2 && j2.data && j2.data.rank_list) || [];
			return rl.filter((x: any) => x.code).map((x: any) => {
				const c = String(x.code);
				const mkt = c.startsWith("sh") ? "sh" : c.startsWith("sz") ? "sz" : c.startsWith("hk") ? "hk" : c.startsWith("us") ? "us" : "";
				const code = c.slice(2);
				const secid = mkt === "sh" ? "1." + code : mkt === "sz" ? "0." + code : mkt === "hk" ? "116." + code : "";
				return { code, name: (x.name || "") + "（" + b.name + "）", type: mkt === "us" ? "us" : "stock", mkt, secid, jp: "" };
			});
		} catch { return []; }
	};
	const searchMarket = async (q: string): Promise<void> => {
		if (!q.trim() || typeof requestUrl !== "function") return;
		const j = await httpJson("https://searchapi.eastmoney.com/api/suggest/get?input=" + encodeURIComponent(q.trim()) + "&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=30");
		const ds: any[] = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
		const hits: any[] = [];
		let bkGot = false;
		for (const d of ds) {
			const type = classifyToType(d.Classify);
			if (type === "fund") { hits.push({ code: d.Code, name: d.Name, type, jp: "" }); continue; }
			if (d.Classify === "BK") {
				// 板块命中：拉成分股（如"白酒"→茅台/五粮液），主/备双源 + ut token
				if (bkGot) continue;
				const bcode = (d.QuoteID || "").split(".")[1] || d.Code;
				const base = "pn=1&pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:" + bcode + "&fields=f12,f13,f14";
				let cl = await httpJson("https://push2.eastmoney.com/api/qt/clist/get?" + base, "https://quote.eastmoney.com/center/boardlist.html");
				let diff: any[] = (cl && cl.data && cl.data.diff) || [];
				if (!diff.length) {
					cl = await httpJson("https://push2delay.eastmoney.com/api/qt/clist/get?" + base, "https://quote.eastmoney.com/center/boardlist.html");
					diff = (cl && cl.data && cl.data.diff) || [];
				}
				if (diff.length) {
					bkGot = true;
					diff.slice(0, 100).forEach((x: any) => {
						const mktn = String(x.f13);
						const mkt = mktn === "1" ? "sh" : mktn === "0" ? "sz" : mktn === "116" ? "hk" : "us";
						const secid = mktn + "." + x.f12;
						hits.push({ code: x.f12, name: x.f14 + "（" + d.Name + "）", type: mkt === "us" ? "us" : "stock", mkt, secid, jp: "" });
					});
				} else {
					const tc = await tencentBoardCons(q);
					if (tc.length) { bkGot = true; tc.forEach((x: any) => hits.push(x)); }
				}
				continue;
			}
			if (!type) continue;
			const secid = d.QuoteID || "";
			hits.push({ code: d.Code, name: d.Name, type, mkt: mktFromSecid(secid), secid, jp: "" });
		}
		const seen = new Set<string>();
		remoteHits = hits.filter((h: any) => { const k = h.code + "|" + h.type; if (seen.has(k)) return false; seen.add(k); return true; });
		renderSearch();
	};
	const renderSearch = () => {
		const q = searchInput.value;
		const local = searchMatches(q);
		const hits = [...local, ...remoteHits.filter((r: any) => !local.some((l: any) => l.code === r.code))];
		setHtml(suggest, ""); suggest.classList.toggle("show", hits.length > 0);
		const showN = 5;
		hits.slice(0, showN).forEach((s: any) => {
			const d = document.createElement("div"); d.className = "sug-item";
			setHtml(d, '<span class="nm">' + esc(s.name) + '</span><span class="cd">' + esc(s.code) + '</span><span class="tb" style="color:' + typeColor(s.type) + ';border-color:' + typeColor(s.type) + '">' + typeTag(s.type) + "</span>");
			d.onclick = () => { searchInput.value = ""; remoteHits = []; renderSearch(); addItem(s); };
			suggest.appendChild(d);
		});
		if (hits.length > showN) {
			const more = document.createElement("div"); more.className = "sug-item more";
			more.textContent = "查看全部 " + hits.length + " 条结果 ›";
			more.onclick = () => { suggest.classList.remove("show"); openAllResults(hits); };
			suggest.appendChild(more);
		}
	};
	const addItem = (s: any) => {
		let it = items.find((i: any) => i.code === s.code && i.type === s.type);
		if (!it) {
			const base: any = { code: s.code, name: s.name, type: s.type, price: 1, pct: 0 };
			if (s.mkt) base.mkt = s.mkt;
			if (s.secid) base.secid = s.secid;
			it = mkItem(base); items.push(it);
		}
		if (!groupOf(it.code)) { const g = groups[0]; if (g) g.items.push(it.code); }
		saveMoney();
		renderAll(); renderSearch(); selectItem(it); searchInput.blur();
		void refreshQuotes(true);
		if (it.type !== "fund" || isETF(it)) void fetchSeries(it);
	};
	const openAllResults = (hits: any[]) => {
		const mask = document.createElement("div"); mask.className = "modal-mask show";
		const types = [
			{ key: "fund", name: "基金", on: true },
			{ key: "stock", name: "股票", on: true },
			{ key: "us", name: "美股", on: true },
			{ key: "index", name: "指数", on: true },
		];
		const typeBtns = types.map((t, ti) => {
			const el = document.createElement("span");
			el.className = "ftb"; el.dataset.ti = String(ti); el.textContent = t.name;
			return el;
		});
		const paint = (el: HTMLElement, t: any) => {
			if (t.on) el.setCssProps({ background: typeColor(t.key), borderColor: typeColor(t.key), color: "#fff" });
			else el.setCssProps({ background: "transparent", borderColor: "var(--line)", color: typeColor(t.key) });
		};
		typeBtns.forEach((el, ti) => paint(el, types[ti]));
		const bar = document.createElement("div"); bar.className = "ftb-bar";
		typeBtns.forEach((el) => bar.appendChild(el));
		const h3 = document.createElement("h3"); h3.textContent = "搜索结果 · " + hits.length + " 条";
		const list = document.createElement("div"); list.className = "all-list"; list.id = "allList";
		const closeBtn = document.createElement("button"); closeBtn.className = "btn sm"; closeBtn.id = "allClose"; closeBtn.textContent = "关闭";
		const acts = document.createElement("div"); acts.className = "acts"; acts.appendChild(closeBtn);
		const modal = document.createElement("div"); modal.className = "modal modal-wide";
		modal.appendChild(h3); modal.appendChild(bar); modal.appendChild(list); modal.appendChild(acts);
		mask.appendChild(modal); root.appendChild(mask);
		const renderRows = () => {
			const show = types.filter((t) => t.on).map((t) => t.key);
			const rows = hits.map((s: any, i: number) => ({ s, i })).filter((o: any) => show.includes(o.s.type));
			setHtml(list, rows.map((o: any) => '<div class="all-item" data-i="' + o.i + '"><span class="tb" style="color:' + typeColor(o.s.type) + ';border-color:' + typeColor(o.s.type) + '">' + typeTag(o.s.type) + '</span><span class="nm">' + esc(o.s.name) + '</span><span class="cd">' + esc(o.s.code) + "</span></div>").join("") || '<div style="color:var(--dim);padding:8px">该分类暂无结果</div>');
			list.querySelectorAll(".all-item").forEach((d) => (d as HTMLElement).onclick = () => {
				const idx = parseInt((d as HTMLElement).dataset.i || "0", 10);
				addItem(hits[idx]);
				mask.remove();
			});
		};
		renderRows();
		typeBtns.forEach((el, ti) => el.onclick = () => {
			types[ti].on = !types[ti].on;
			paint(el, types[ti]);
			renderRows();
		});
		closeBtn.onclick = () => mask.remove();
		mask.addEventListener("mousedown", (e) => { if (e.target === mask) mask.remove(); });
	};
	searchInput.addEventListener("input", () => {
		renderSearch();
		if (searchTimer != null) window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => void searchMarket(searchInput.value), 280);
	});
	searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { const m = searchMatches(searchInput.value).concat(remoteHits); if (m.length) addItem(m[0]); } });
	$("#searchBtn").onclick = () => {
		const q = searchInput.value;
		if (!q.trim()) { suggest.classList.remove("show"); return; }
		renderSearch();
		void searchMarket(q);
		searchInput.focus();
	};
	const onDocClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".sb-search")) { suggest.classList.remove("show"); remoteHits = []; } };
	document.addEventListener("click", onDocClick);
	cleanups.push(() => document.removeEventListener("click", onDocClick));

	/* ---------- 弹窗 ---------- */
	let modalRoot: HTMLElement | null = null;
	const openModal = (title: string, bodyHtml: string, onOk: () => void | boolean) => {
		const mask = document.createElement("div"); mask.className = "modal-mask show"; mask.id = "modalMask";
		setHtml(mask, '<div class="modal"><h3>' + esc(title) + "</h3>" + bodyHtml + '<div class="acts"><button class="btn sm" id="mCancel">取消</button><button class="btn sm nya-modal-ok" id="mOk">确定</button></div></div>');
		root.appendChild(mask);
		mask.addEventListener("mousedown", (e) => { if (e.target === mask) mask.remove(); });
		(mask.querySelector("#mCancel") as HTMLElement).onclick = () => mask.remove();
		(mask.querySelector("#mOk") as HTMLElement).onclick = () => { const v = onOk(); if (v !== false) mask.remove(); };
		modalRoot = mask;
	};
	const openAddModal = () => {
		const opts = items.map((it: any) => '<option value="' + it.code + '">' + it.name + " · " + typeTag(it.type) + " · " + it.code + "</option>").join("");
		openModal("添加标的到自选", '<label>选择标的</label><select id="mCode">' + opts + "</select>" + '<label>目标分组</label><select id="mGrp">' + groups.map((g: any) => '<option value="' + g.id + '">' + g.name + "</option>").join("") + "</select>", () => {
			const code = (modalRoot as HTMLElement).querySelector("#mCode") as HTMLSelectElement, gi = (modalRoot as HTMLElement).querySelector("#mGrp") as HTMLSelectElement;
			const g = groups.find((x: any) => x.id === gi.value); if (g && !g.items.includes(code.value)) g.items.push(code.value);
			saveMoney();
			renderAll(); renderGroups();
		});
	};
	const openHoldModal = () => {
		const opts = items.map((it: any) => '<option value="' + it.code + '">' + it.name + " · " + typeTag(it.type) + " · " + it.code + "</option>").join("");
		openModal("添加持有", '<label>标的</label><select id="mCode">' + opts + "</select>" + '<label>份额/股数</label><input id="mShares" type="number" min="0" step="1" value="1000">' + '<label>买入成本价</label><input id="mCost" type="number" min="0" step="0.001" value="1.0">', () => {
			const it = items.find((i: any) => i.code === ((modalRoot as HTMLElement).querySelector("#mCode") as HTMLSelectElement).value);
			if (!it) return;
			holdings.push({ code: it.code, name: it.name, type: it.type, shares: +((modalRoot as HTMLElement).querySelector("#mShares") as HTMLInputElement).value, cost: +((modalRoot as HTMLElement).querySelector("#mCost") as HTMLInputElement).value });
			saveMoney();
			renderHold();
		});
	};

	/* ---------- 详情 ---------- */
	const selectItem = (it: any) => {
		if (!it) { setHtml($("#dTop"), '<div class="d-id" style="color:var(--dim)">请添加标的</div>'); return; }
		curItem = it; curRange = "intraday"; view.count = null; view.end = null;
		syncTabClasses(); syncTabs(); renderDetail(); renderCurrent(); renderChart();
		void fetchSeries(it);
		if (cmpOn) void loadBench(it);
	};
	const syncTabClasses = () => {
		$$(".c-tab[data-range]").forEach((t) => t.classList.toggle("on", t.dataset.range === curRange));
		$$(".c-tab[data-ind]").forEach((t) => t.classList.toggle("on", t.dataset.ind === curInd));
		updateIndNote();
	};
	const updateIndNote = () => {
		const note = $("#indNote");
		if (!note) return;
		const txt = !isK() ? "" : (({ macd: "金叉偏多 / 死叉偏空", kdj: "K>80超买 / K<20超卖", rsi: ">70超买 / <30超卖" } as any)[curInd] || "");
		note.textContent = txt;
	};
	const fmtN = (v: any) => (typeof v === "number" ? v.toLocaleString("zh-CN", { maximumFractionDigits: 3 }) : v);
	const renderDetail = () => {
		const it = curItem; if (!it) return;
		const g = groups.find((x: any) => x.id === groupOf(it.code));
		const tags = '<span class="tag">' + typeTag(it.type) + '</span><span class="tag">' + it.code + "</span>" + (g ? '<span class="tag">' + g.name + "</span>" : "");
		let stats = Object.keys(it.stats).map((k) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + fmtN(it.stats[k]) + "</div></div>").join("");
		if (it.type === "fund") {
			const est = it.est;
			stats += '<div class="stat"><div class="k">盘中估值</div><div class="v ' + (est ? (est.pct >= 0 ? "up" : "down") : "flat") + '">' + (est ? ((est.pct >= 0 ? "+" : "") + est.pct.toFixed(2) + "% · " + est.name) : "—") + "</div></div>";
		}
		setHtml($("#dTop"),
			'<div class="d-id"><div class="nm">' + esc(it.name) + '</div><div class="cd">' + esc(it.code) + " · " + typeTag(it.type) + '</div><div class="d-tags">' + tags + "</div></div>" +
			'<div class="d-price"><div class="px ' + cls(it.pct) + '">' + it.price.toFixed(3) + "</div>" +
			'<div class="chg ' + cls(it.pct) + '">' + (it.pct >= 0 ? "+" : "") + it.pct.toFixed(2) + "%　" + (it.amt >= 0 ? "+" : "") + it.amt.toFixed(3) + "</div>" +
			'<div class="nya-detail-cmp"><button class="btn sm" id="btnCmp" title="叠加对应大盘指数，对比走势">' + (cmpOn ? "✕ 取消对比" : "⇆ 对比大盘") + "</button></div></div>" +
			'<div class="d-stats">' + stats + "</div>");
		const bc = $("#btnCmp");
		if (bc) bc.onclick = () => {
			cmpOn = !cmpOn;
			if (cmpOn) void loadBench(curItem);
			else { curItem._bench = null; }
			renderDetail(); renderChart();
		};
	};

	/* ---------- 图表 ---------- */
	const cv = $("#cv") as HTMLCanvasElement, ctx = cv.getContext("2d") as CanvasRenderingContext2D, tip = $("#tip");
	const cvX = $("#cvX") as HTMLCanvasElement, ctxX = cvX.getContext("2d") as CanvasRenderingContext2D;
	const fitCanvas = () => {
		const box = cv.parentElement!.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		cv.width = Math.max(10, box.width * dpr); cv.height = Math.max(10, box.height * dpr);
		cvX.width = cv.width; cvX.height = cv.height;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctxX.setTransform(dpr, 0, 0, dpr, 0, 0);
	};
	const clearCross = () => ctxX.clearRect(0, 0, cvX.width, cvX.height);
	const hasInd = () => series().kind === "k" && curInd !== "none";
	const isK = () => curRange === "daily" || curRange === "weekly" || curRange === "monthly";
	const isETF = (it: any) => it.type === "fund" && /^(51|56|58|159|15)\d{4}$/.test(String(it.code || ""));
	const isOffFund = (it: any) => it.type === "fund" && !isETF(it);
	const padYMD = (d: Date) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
	const todayYMD = () => padYMD(new Date());
	const daysAgoYMD = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return padYMD(d); };
	let navType = "acc";
	let view = { count: null as number | null, end: null as number | null };
	let dragState: { x0: number; y0: number; end0: number; count0: number; moved: boolean } | null = null;
	const syncTabs = () => {
		const off = curItem ? isOffFund(curItem) : false;
		$$(".c-tab[data-range]").forEach((t: any) => {
			const lf = t.dataset.lf, lk = t.dataset.lk;
			if (t.dataset.range === "monthly") { if (off) hide(t); else show(t); return; }
			t.textContent = off && lf ? lf : (lk || t.textContent);
			show(t);
		});
		const itabs = root.querySelector(".ind-tabs") as HTMLElement;
		if (itabs) { if (off) hide(itabs); else show(itabs); }
		const navSeg = $("#navSeg");
		if (navSeg) { if (off && (curRange === "y1" || curRange === "y3" || curRange === "y5")) show(navSeg); else hide(navSeg); }
	};
	const rawSeries = (): any => {
		const it = curItem, R = it._real || {};
		if (!R) return { kind: "empty" };
		if (isOffFund(it)) {
			const navU: number[] = R.navUnit || [];
			const navA: number[] = R.navAcc || [];
			const navDates: string[] = R.navDates || [];
			if (curRange === "intraday") {
				const d = R.estCurve;
				if (!d || !d.prices || !d.prices.length) return { kind: "empty" };
				return { kind: "intraday", d, estOnly: !it.proxy };
			}
			if (curRange === "daily") { const r = sliceNav(navU, navDates, daysAgoYMD(7), todayYMD(), it); return r.d.length ? r : { kind: "empty" }; }
			if (curRange === "weekly") { const r = sliceNav(navU, navDates, daysAgoYMD(30), todayYMD(), it); return r.d.length ? r : { kind: "empty" }; }
			const useAcc = navType === "acc";
			const arr = useAcc ? navA : navU;
			if (!arr.length) return { kind: "empty" };
			const key = curRange === "y1" ? 250 : curRange === "y3" ? 750 : 99999;
			const sl = arr.length > key ? arr.slice(-key) : arr;
			const dl = navDates.length > key ? navDates.slice(-key) : navDates;
			return { kind: "line", d: sl, dates: dl, isNav: true, navType: useAcc ? "累计" : "单位" };
		}
		if (curRange === "intraday") { const d = R.intraday; return d && d.prices && d.prices.length ? { kind: "intraday", d } : { kind: "empty" }; }
		if (curRange === "daily") { const d = R.dk; return d && d.length ? { kind: "k", d, dates: R.dts ? R.dts.dk : undefined } : { kind: "empty" }; }
		if (curRange === "weekly") { const d = R.wk; return d && d.length ? { kind: "k", d, dates: R.dts ? R.dts.wk : undefined } : { kind: "empty" }; }
		if (curRange === "monthly") { const d = R.mk; return d && d.length ? { kind: "k", d, dates: R.dts ? R.dts.mk : undefined } : { kind: "empty" }; }
		const key = curRange === "m1" ? "m1" : curRange === "y1" ? "y1" : curRange === "y3" ? "y3" : "y5";
		const d = R[key] || [];
		return d.length ? { kind: "line", d, dates: R.dts ? R.dts[key] : undefined } : { kind: "empty" };
	};	const sliceNav = (vals: number[], dates: string[], start: string, end: string, it: any): any => {
		const out: number[] = [], od: string[] = [];
		for (let i = 0; i < dates.length; i++) {
			if (dates[i] >= start && dates[i] <= end) { od.push(dates[i]); out.push(vals[i]); }
		}
		if (out.length && it.est && it.est.pct != null) {
			const last = out[out.length - 1];
			od.push(todayYMD()); out.push(+(last * (1 + it.est.pct / 100)).toFixed(4));
		}
		return { kind: "line", d: out, dates: od, isNav: true, navType: "单位", est: !!(it.est && it.est.pct != null) };
	};
	let dataVersion = 0;
	let seriesCacheKey = "", seriesCacheVal: any = null;
	const series = (): any => {
		const it = curItem;
		const key = it ? (it.code + "|" + curRange + "|" + navType + "|" + (view.count == null ? "a" : view.count) + "|" + (view.end == null ? "b" : view.end) + "|" + dataVersion) : "";
		if (key === seriesCacheKey) return seriesCacheVal;
		const s = rawSeries();
		if (s.kind === "intraday") { seriesCacheKey = key; seriesCacheVal = s; return s; }
		const total = s.d ? s.d.length : 0;
		if (!total) { seriesCacheKey = key; seriesCacheVal = s; return s; }
		let end = view.end == null ? total : Math.min(view.end, total);
		let count = view.count == null ? total : Math.min(view.count, total);
		count = Math.max(2, Math.min(count, total));
		const start = Math.max(0, end - count);
		const sl = s.d.slice(start, end);
		const dl = s.dates ? s.dates.slice(start, end) : s.dates;
		const out = Object.assign({}, s, { full: s.d, fullDates: s.dates, d: sl, dates: dl, start, end, total, count });
		seriesCacheKey = key; seriesCacheVal = out;
		return out;
	};
	const syncZoomUI = () => {
		const bar = $("#zoomBar");
		if (!bar) return;
		const S = series();
		const isZ = S.kind === "k" || S.kind === "line";
		bar.style.display = isZ ? "" : "none";
		if (!isZ) return;
		$$("#zoomBar .zbtn[data-z]").forEach((b: any) => {
			const v = b.dataset.z || "";
			b.classList.toggle("on", (v === "all") ? view.count == null : view.count === +v);
		});
		const range = $("#zRange");
		if (range) {
			const d0 = S.dates && S.dates[0] ? S.dates[0] : "";
			const d1 = S.dates && S.dates.length ? S.dates[S.dates.length - 1] : "";
			range.textContent = "显示 " + (d0 ? d0.slice(5) : "?") + " ~ " + (d1 ? d1.slice(5) : "?") + "（" + S.d.length + "/" + S.total + "）";
		}
	};
	$$("#zoomBar .zbtn[data-z]").forEach((b) => b.onclick = () => {
		const v = b.dataset.z || "";
		if (v === "all") { view.count = null; view.end = null; }
		else { view.count = +v; view.end = null; }
		syncZoomUI(); renderChart();
	});
	$$("#navSeg .zbtn[data-nav]").forEach((b) => b.onclick = () => {
		navType = b.dataset.nav === "acc" ? "acc" : "unit";
		$$("#navSeg .zbtn").forEach((x) => x.classList.toggle("on", x === b));
		syncTabs(); renderChart();
	});
	let geoR: any = {};
	const geometry = (w: number, h: number) => {
		const padL = 56, padR = 56, padT = 8, padB = 34, total = h - padT - padB;
		const S0 = series();
		const isLine = S0.kind === "line";
		const ind = !isLine && hasInd();
		const gap = 14;
		const mainH = isLine ? total : (ind ? total * 0.6 : total * 0.74);
		const volH = isLine ? 0 : (ind ? total * 0.17 : Math.max(30, total - mainH - gap));
		const indH = isLine ? 0 : (ind ? Math.max(30, total - mainH - volH - 2 * gap) : 0);
		return {
			padL, padR, padT, padB,
			main: { x: padL, y: padT, w: w - padL - padR, h: mainH },
			vol: { x: padL, y: padT + mainH + gap, w: w - padL - padR, h: volH },
			ind: { x: padL, y: padT + mainH + gap + volH + gap, w: w - padL - padR, h: indH },
		};
	};
	const ema = (arr: number[], n: number) => { const k = 2 / (n + 1); let e = arr[0]; return arr.map((v) => { e = v * k + e * (1 - k); return e; }); };
	const macd = (closes: number[]) => { const e12 = ema(closes, 12), e26 = ema(closes, 26); const dif = closes.map((v, i) => e12[i] - e26[i]); const dea = ema(dif, 9); return { dif, dea, hist: dif.map((v, i) => (v - dea[i]) * 2) }; };
	const kdj = (arr: any[]) => { const n = 9; const kk: number[] = [], dd: number[] = [], jj: number[] = []; let K = 50, D = 50;
		for (let i = 0; i < arr.length; i++) {
			const s = Math.max(0, i - n + 1);
			const lo = Math.min.apply(null, arr.slice(s, i + 1).map((o) => o[3]));
			const hi = Math.max.apply(null, arr.slice(s, i + 1).map((o) => o[2]));
			const kk_ = (arr[i][1] + arr[i][2] + arr[i][3]) / 3;
			const rsv = hi === lo ? 50 : ((kk_ - lo) / (hi - lo)) * 100;
			K = (2 / 3) * K + (1 / 3) * rsv; D = (2 / 3) * D + (1 / 3) * K;
			kk.push(K); dd.push(D); jj.push(3 * K - 2 * D);
		}
		return { k: kk, d: dd, j: jj };
	};
	const rsi = (closes: number[], n = 14) => { let ag = 0, al = 0; const out: number[] = [];
		for (let i = 1; i < closes.length; i++) {
			const ch = closes[i] - closes[i - 1];
			if (ch > 0) ag += ch; else if (ch < 0) al += -ch;
			const rs = ag / n / (al / n || 1e-9);
			out.push(100 - 100 / (1 + rs));
		}
		return out;
	};
	const fmtVol = (v: number) => { if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿"; if (v >= 1e4) return (v / 1e4).toFixed(1) + "万"; return "" + Math.round(v); };
	const drawYLabels = (region: any, min: number, max: number, dec: number, opt?: any) => {
		opt = opt || {};
		const count = opt.count || 5, color = opt.color || "#5c6470", fmt = opt.fmt || ((v: number) => v.toFixed(dec || 2));
		ctx.fillStyle = color; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
		const span = (max - min) || 1;
		for (let g = 0; g <= count - 1; g++) { const v = max - span * g / (count - 1); ctx.fillText(fmt(v), region.x - 6, region.y + region.h * g / (count - 1)); }
		ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	};
	const gridLine = (y: number, color?: string, dash?: number[]) => { ctx.strokeStyle = color || "#232833"; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.clientWidth, y); ctx.stroke(); ctx.setLineDash([]); };
	/* ---------- 主渲染 ---------- */
	let cmpOn = false;
	const benchOf = (it: any) => {
		if (it.type === "us") return { secid: "100.NDX", name: "纳斯达克", mkt: "us" };
		if (it.mkt === "hk") return { secid: "100.HSI", name: "恒生指数", mkt: "hk" };
		if (it.mkt === "sh" || it.mkt === "sz") return { secid: "1.000001", name: "上证指数", mkt: "sh" };
		if (it.type === "fund") return { secid: "1.000300", name: "沪深300", mkt: "sh" };
		return null;
	};
	const loadBench = async (it: any): Promise<void> => {
		const b = benchOf(it); if (!b) return;
		const klt = curRange === "weekly" ? 102 : curRange === "monthly" ? 103 : 101;
		let closes: number[] = [];
		const lmt = curRange === "y3" ? 750 : curRange === "y5" ? 1250 : curRange === "y1" ? 250 : curRange === "m1" ? 30 : curRange === "intraday" ? 240 : 180;
		const k = await httpJson("https://63.push2his.eastmoney.com/api/qt/stock/kline/get?secid=" + b.secid + "&klt=" + (curRange === "intraday" ? 1 : klt) + "&fqt=1&end=20500000&lmt=1000000&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
		const kl: string[] = (k && k.data && k.data.klines) || [];
		if (kl.length) closes = kl.map((s: string) => +s.split(",")[2]);
		if (!closes.length) {
			// 腾讯备用：A股/港股指数 / 美股指数
			const ts = b.secid.startsWith("1.") ? "sh000001" : b.secid.startsWith("116") ? "hkHSI" : b.mkt === "us" ? "usIXIC" : "sh000300";
			const tk = await httpJson("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + ts + "," + (curRange === "weekly" ? "week" : curRange === "monthly" ? "month" : "day") + ",,,1250,qfq", "https://gu.qq.com/");
			const tdata = tk && tk.data && tk.data[ts];
			const tarr: string[][] = (tdata && (tdata.qfqday || tdata.day || tdata.qfqweek || tdata.week || tdata.qfqmonth || tdata.month)) || [];
			if (tarr.length) closes = tarr.map((bb) => +bb[2]);
		}
		it._bench = closes;
		if (curItem === it) renderChart();
	};
	const drawBenchOverlay = (S: any, geo: any, it: any) => {
		const b = it._bench; if (!b || b.length < 2) return;
		let main: number[];
		if (S.kind === "intraday") { const pr = S.d.prices; const base = pr[0] || 1; main = pr.map((v: number) => (v - base) / base * 100); }
		else { const arr = S.kind === "k" ? S.d.map((o: any) => o[1]) : S.d; const base = arr[0] || 1; main = arr.map((v: number) => (v - base) / base * 100); }
		const bb = b[0] || 1; const bench = b.map((v: number) => (v - bb) / bb * 100);
		const len = Math.min(main.length, bench.length);
		const m = main.slice(-len), be = bench.slice(-len);
		const all = m.concat(be);
		const mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), span = (mx - mn) || 1;
		const px = (i: number) => geo.main.x + (geo.main.w * i) / (len - 1);
		const py = (v: number) => geo.main.y + geo.main.h - ((v - mn) / span) * geo.main.h;
		gridLine(py(0), "#5a6270", [4, 4]);
		const col = dirC(m[m.length - 1]);
		ctx.strokeStyle = col; ctx.lineWidth = 1.8;
		ctx.beginPath(); m.forEach((v: number, i: number) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)))); ctx.stroke();
		ctx.strokeStyle = "#26a0a0"; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
		ctx.beginPath(); be.forEach((v: number, i: number) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)))); ctx.stroke();
		ctx.setLineDash([]);
		ctx.font = "11px sans-serif"; ctx.textAlign = "left";
		ctx.fillStyle = col; ctx.fillText(rangeName() + " " + (m[m.length - 1] >= 0 ? "+" : "") + m[m.length - 1].toFixed(2) + "%", geo.main.x + 8, geo.main.y + 18);
		ctx.fillStyle = "#26a0a0"; ctx.fillText("大盘(" + (benchOf(it)?.name || "") + ") " + (be[be.length - 1] >= 0 ? "+" : "") + be[be.length - 1].toFixed(2) + "%", geo.main.x + 8, geo.main.y + 36);
		ctx.textAlign = "left";
		drawYLabels(geo.main, mn, mx, 2);
	};
	const rangeName = (): string => {
		if (curItem && isOffFund(curItem)) return ({ intraday: "当日", daily: "当周", weekly: "当月", m1: "近1月", y1: "近1年", y3: "近3年", y5: "近5年" } as any)[curRange] || "";
		return ({ m1: "近1月", y1: "近1年", y3: "近3年", y5: "近5年" } as any)[curRange] || (curRange === "daily" ? "日K" : curRange === "weekly" ? "周K" : "月K");
	};
	const showChartMsg = (txt: string) => {
		const el = root.querySelector(".chart-msg") as HTMLElement;
		if (el) { el.textContent = txt; show(el); }
	};
	const hideChartMsg = () => {
		const el = root.querySelector(".chart-msg") as HTMLElement;
		if (el) hide(el);
	};
	const renderChart = () => {
		fitCanvas();
		const w = cv.clientWidth, h = cv.clientHeight;
		ctx.clearRect(0, 0, w, h);
		clearCross();
		if (!curItem) { showChartMsg("请先在上方搜索添加基金 / 股票 / 美股"); syncZoomUI(); return; }
		geoR = geometry(w, h);
		const S = series();
		if (S.kind === "empty") {
			const busy = curItem._loading || (curItem._real && curItem._real.fetchedAt && Date.now() - curItem._real.fetchedAt < 2000);
			let msg = "暂无数据（数据源不可用，未获取到真实行情）";
			if (curItem._estErr) msg = curItem._estErr;
			else if (!busy && curRange === "intraday" && isOffFund(curItem)) msg = "主动基金暂无盘中估值数据（当前无免费估值源），可查看当周/当月净值走势";
			else if (!busy && curRange === "intraday" && (curItem.type === "us" || curItem.mkt === "us")) msg = "美股分时暂无可用免费数据源，可查看日K / 周K / 月K";
			if (busy) msg = "正在加载真实行情…";
			showChartMsg(msg);
			syncZoomUI();
			return;
		}
		hideChartMsg();
		if (cmpOn && curItem._bench && curItem._bench.length > 1) {
			drawBenchOverlay(S, geoR, curItem);
		} else {
			if (S.kind === "intraday") drawIntraday(S.d, geoR, curItem);
			else if (S.kind === "k") drawK(S, geoR, curItem);
			else drawLineS(S, geoR, curItem);
			if (S.kind === "line" && S.d && S.d.length > 1) {
				const pct = (S.d[S.d.length - 1] - S.d[0]) / S.d[0] * 100;
				ctx.font = "bold 12px sans-serif";
				ctx.fillStyle = pct >= 0 ? upC() : dnC();
				ctx.fillText(rangeName() + "  " + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%", geoR.main.x + 8, geoR.main.y + 18);
			}
			if (S.kind === "intraday" && S.estOnly && S.d && S.d.prices && S.d.prices.length) {
				ctx.font = "11px sans-serif"; ctx.textAlign = "right";
				ctx.fillStyle = "#8b93a1";
				ctx.fillText("盘中估值 · 仅供参考", geoR.main.x + geoR.main.w - 8, geoR.main.y + 16);
				ctx.textAlign = "left";
			}
		}
		renderLegend();
		syncZoomUI();
	};
	const maAt = (n: number) => { const S = series(); const c = ((S.full && S.full.length ? S.full : (S.d || [])) as any[]).map((o: any) => o[1]); if (c.length < n) return "—"; let s = 0; for (let i = c.length - n; i < c.length; i++) s += c[i]; return (s / n).toFixed(2); };
	const renderLegend = () => {
		const it = curItem;
		const S = series();
		if (curRange === "intraday") {
			const last = S.d && S.d.prices ? S.d.prices[S.d.prices.length - 1] : it.price;
			$("#lgLeft").textContent = it.name + " · " + rangeName() + (S.estOnly ? " · 盘中估值" : "");
			$("#lgRight").textContent = "最新 " + (last == null ? it.price.toFixed(3) : last.toFixed(3));
		} else if (S.kind === "k") {
			const d = S.d;
			const maTxt = '<span style="color:#ffd166">●</span>MA5 <b style="color:#ffd166">' + maAt(5) + '</b>　<span style="color:#4c8dff">●</span>MA10 <b style="color:#4c8dff">' + maAt(10) + '</b>　<span style="color:#c678dd">●</span>MA20 <b style="color:#c678dd">' + maAt(20) + "</b>";
			const indTxt = hasInd() ? "　|　" + indValues(d) : "";
			setHtml($("#lgLeft"), maTxt + indTxt);
			const c = d[d.length - 1];
			$("#lgRight").textContent = it.name + " · " + rangeName() + "  收 " + c[1].toFixed(2);
		} else {
			const seq = S.d || [];
			const navTxt = S.navType ? " · " + S.navType + "净值" : "";
			const rp = seq.length > 1 ? (seq[seq.length - 1] - seq[0]) / seq[0] * 100 : 0;
			$("#lgLeft").textContent = it.name + " · " + rangeName() + navTxt;
			$("#lgRight").textContent = "最新 " + (seq.length ? seq[seq.length - 1].toFixed(3) : "—") + "　" + (rp >= 0 ? "+" : "") + rp.toFixed(2) + "%";
		}
	};
	

	const indValues = (d: any): string => {
		const closes = d.map((o: any) => o[1]);
		if (curInd === "macd") { const m = macd(closes); const li = m.dif.length - 1; return "MACD  DIF <b style=\"color:#4c8dff\">" + m.dif[li].toFixed(3) + "</b>  DEA <b style=\"color:#ffd166\">" + m.dea[li].toFixed(3) + "</b>  柱 <b class=\"" + (m.hist[li] >= 0 ? "up" : "down") + "\">" + (m.hist[li] >= 0 ? "+" : "") + m.hist[li].toFixed(3) + "</b>"; }
		if (curInd === "kdj") { const k = kdj(d); const li = k.k.length - 1; return "KDJ  K <b style=\"color:#f2f2f2\">" + k.k[li].toFixed(1) + "</b>  D <b style=\"color:#ffd166\">" + k.d[li].toFixed(1) + "</b>  J <b style=\"color:#c678dd\">" + k.j[li].toFixed(1) + "</b>"; }
		if (curInd === "rsi") { const r = rsi(closes); const li = r.length - 1; return "RSI(14)  <b style=\"color:#ffd166\">" + r[li].toFixed(1) + "</b>"; }
		return "";
	};

	/* ---------- 分时 ---------- */
	const drawIntraday = (d: any, geo: any, it: any) => {
		const { prices, vols, avg } = d, n = prices.length;
		const min = Math.min.apply(null, prices), max = Math.max.apply(null, prices), span = (max - min) || 1;
		const y0 = geo.main.y + geo.main.h - ((it.prev - min) / span) * geo.main.h;
		gridLine(y0, "#3a4150", [4, 4]);
		const px = (i: number) => geo.main.x + (geo.main.w * i) / (n - 1);
		const py = (v: number) => geo.main.y + geo.main.h - ((v - min) / span) * geo.main.h;
		ctx.strokeStyle = "#e0b341"; ctx.lineWidth = 1.4;
		ctx.beginPath(); avg.forEach((v: number, i: number) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)))); ctx.stroke();
		const col = dirC(it.pct);
		ctx.strokeStyle = col; ctx.lineWidth = 1.8;
		ctx.beginPath(); prices.forEach((v: number, i: number) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)))); ctx.stroke();
		const g = ctx.createLinearGradient(0, geo.main.y, 0, geo.main.y + geo.main.h);
		g.addColorStop(0, col + "18"); g.addColorStop(1, "rgba(0,0,0,0)");
		ctx.lineTo(px(n - 1), geo.main.y + geo.main.h); ctx.lineTo(px(0), geo.main.y + geo.main.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
		drawYLabels(geo.main, min, max, 2);
		const maxV = Math.max.apply(null, vols);
		ctx.fillStyle = "#262b34"; ctx.fillRect(geo.vol.x, geo.vol.y, geo.vol.w, geo.vol.h);
		for (let i = 0; i < n; i++) {
			const bh = (vols[i] / maxV) * geo.vol.h;
			ctx.fillStyle = vols[i] > vols[Math.max(0, i - 1)] ? upC() : dnC();
			ctx.fillRect(px(i) - (geo.vol.w / n) * 0.35, geo.vol.y + geo.vol.h - bh, (geo.vol.w / n) * 0.7, bh);
		}
		drawYLabels(geo.vol, 0, maxV, 0, { count: 3, color: "#4a5260", fmt: fmtVol });
		// 副图标注：成交量
		ctx.textAlign = "left"; ctx.fillStyle = "#8b93a1"; ctx.font = "10px sans-serif";
		ctx.fillText("成交量", geo.vol.x + 4, geo.vol.y + 10);
		// 横坐标：用实际分时时间（适配 A股/港股/美股/指数估算），取 首 / 1/4 / 中 / 3/4 / 尾
		ctx.textAlign = "center"; ctx.fillStyle = "#5c6470";
		const tY = geo.vol.y + geo.vol.h + 15;
		[0, 0.25, 0.5, 0.75, 1].forEach((f) => {
			const idx = Math.round((n - 1) * f);
			const label = d.times && d.times[idx] ? d.times[idx] : "";
			ctx.fillText(label, geo.main.x + geo.main.w * f, tY);
		});
		ctx.textAlign = "left";
	};
	/* ---------- K线 ---------- */
	const drawK = (S: any, geo: any, it: any) => {
		const ohlc = S.d, dates = S.dates, n = ohlc.length, closes = ohlc.map((o: any) => o[1]);
		const fullArr = (S.full && S.full.length ? S.full : ohlc);
		const fullCloses = fullArr.map((o: any) => o[1]);
		const fstart = Math.max(0, S.start || 0);
		const min = Math.min.apply(null, ohlc.map((o: any) => o[3])), max = Math.max.apply(null, ohlc.map((o: any) => o[2])), span = (max - min) || 1;
		const px = (i: number) => geo.main.x + (geo.main.w * (i + 0.5)) / n;
		const py = (v: number) => geo.main.y + geo.main.h - ((v - min) / span) * geo.main.h;
		const bw = Math.max(1.5, Math.min(9, (geo.main.w / n) * 0.62));
		for (let i = 0; i < n; i++) {
			const o = ohlc[i], c = closes[i], col = c >= o[0] ? upC() : dnC();
			ctx.strokeStyle = col; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(px(i), py(o[2])); ctx.lineTo(px(i), py(o[3])); ctx.stroke();
			ctx.fillStyle = col;
			ctx.fillRect(px(i) - bw / 2, Math.min(py(o[0]), py(c)), bw, Math.max(1, Math.abs(py(c) - py(o[0]))));
		}
		const ma = (nn: number, col: string) => {
			ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); let started = false;
			for (let i = 0; i < n; i++) {
				const fi = fstart + i;
				if (fi < nn - 1) continue;
				let s = 0; for (let j = fi - nn + 1; j <= fi; j++) s += fullCloses[j];
				const v = s / nn, x = px(i), y = py(v);
				if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
			}
			ctx.stroke();
		};
		ma(5, "#ffd166"); ma(10, "#4c8dff"); ma(20, "#c678dd");
		ctx.font = "11px sans-serif";
		const lastMa = (nn: number) => { let sm = 0; for (let i = fullCloses.length - nn; i < fullCloses.length; i++) sm += fullCloses[i]; return sm / nn; };
		ctx.fillStyle = "#ffd166"; ctx.fillText("MA5", px(n - 1) + 4, py(lastMa(5)) + 4);
		ctx.fillStyle = "#4c8dff"; ctx.fillText("MA10", px(n - 1) + 4, py(lastMa(10)) + 4);
		ctx.fillStyle = "#c678dd"; ctx.fillText("MA20", px(n - 1) + 4, py(lastMa(20)) + 4);
		drawYLabels(geo.main, min, max, 2);
		const maxV = Math.max.apply(null, ohlc.map((o: any) => o[4]));
		for (let i = 0; i < n; i++) {
			const o = ohlc[i]; const bh = (o[4] / maxV) * geo.vol.h;
			ctx.fillStyle = o[1] >= o[0] ? upC() : dnC();
			ctx.fillRect(px(i) - bw / 2, geo.vol.y + geo.vol.h - bh, bw, bh);
		}
		drawYLabels(geo.vol, 0, maxV, 0, { count: 3, color: "#4a5260", fmt: fmtVol });
		ctx.textAlign = "left"; ctx.fillStyle = "#8b93a1"; ctx.font = "10px sans-serif";
		ctx.fillText("成交量", geo.vol.x + 4, geo.vol.y + 10);
		if (hasInd()) {
			const ind = geo.ind;
			ctx.fillStyle = "#262b34"; ctx.fillRect(ind.x, ind.y, ind.w, ind.h);
			ctx.strokeStyle = "#232833";
			for (let g = 0; g <= 2; g++) { const y = ind.y + (ind.h * g) / 2; ctx.beginPath(); ctx.moveTo(ind.x, y); ctx.lineTo(ind.x + ind.w, y); ctx.stroke(); }
			const drawInd = (arr: number[], col: string, iy: (v: number) => number, off = 0, lw = 1.2) => {
				ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); let started = false;
				for (let i = 0; i < n; i++) {
					const fi = fstart + i;
					if (fi < off || fi >= arr.length + off) continue;
					const v = arr[fi - off], x = px(i), y = iy(v);
					if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
				}
				ctx.stroke();
			};
			if (curInd === "macd") {
				const m = macd(fullCloses), vals = m.hist.concat(m.dif).concat(m.dea);
				const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), sp = (mx - mn) || 1;
				const iy = (v: number) => ind.y + ind.h - ((v - mn) / sp) * ind.h;
				drawInd(m.dif, upC(), iy);
				drawInd(m.dea, "#e0b341", iy);
				for (let i = 0; i < n; i++) { const fi = fstart + i; if (fi >= m.hist.length) continue; ctx.fillStyle = m.hist[fi] >= 0 ? upC() : dnC(); ctx.fillRect(px(i) - bw / 2, Math.min(iy(0), iy(m.hist[fi])), bw, Math.max(1, Math.abs(iy(0) - iy(m.hist[fi])))); }
				const _li = fullCloses.length - 1;
				ctx.fillStyle = "#5c6470"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
				ctx.fillText("MACD  DIF " + m.dif[_li].toFixed(3) + "  DEA " + m.dea[_li].toFixed(3) + "  柱 " + (m.hist[_li] >= 0 ? "+" : "") + m.hist[_li].toFixed(3), ind.x + 4, ind.y + 10);
				ctx.textAlign = "left";
			} else if (curInd === "kdj") {
				const k = kdj(fullArr), iy = (v: number) => ind.y + ind.h - (v / 100) * ind.h;
				drawInd(k.k, "#f2f2f2", iy);
				drawInd(k.d, "#e0b341", iy);
				drawInd(k.j, "#c678dd", iy);
				const _li = fullArr.length - 1;
				ctx.fillStyle = "#5c6470"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
				ctx.fillText("KDJ  K " + k.k[_li].toFixed(1) + "  D " + k.d[_li].toFixed(1) + "  J " + k.j[_li].toFixed(1), ind.x + 4, ind.y + 10);
				ctx.textAlign = "left";
			} else if (curInd === "rsi") {
				const r = rsi(fullCloses), iy = (v: number) => ind.y + ind.h - (v / 100) * ind.h;
				drawInd(r, "#e0b341", iy, 1, 1.3);
				[30, 70].forEach((v) => { ctx.strokeStyle = "#3a4150"; ctx.setLineDash([3, 3]); ctx.beginPath(); const y = iy(v); ctx.moveTo(ind.x, y); ctx.lineTo(ind.x + ind.w, y); ctx.stroke(); ctx.setLineDash([]); });
				const _li = r.length - 1;
				ctx.fillStyle = "#5c6470"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
				ctx.fillText("RSI(14)  " + r[_li].toFixed(1), ind.x + 4, ind.y + 10);
				ctx.textAlign = "left";
			}
		}
		ctx.strokeStyle = "#232833";
		for (let g = 0; g <= 4; g++) { const y = geo.main.y + (geo.main.h * g) / 4; ctx.beginPath(); ctx.moveTo(geo.main.x, y); ctx.lineTo(geo.main.x + geo.main.w, y); ctx.stroke(); }
		ctx.fillStyle = "#5c6470"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
		const tY = (hasInd() ? geo.ind.y + geo.ind.h : geo.vol.y + geo.vol.h) + 15;
		[0, 0.5, 1].forEach((f) => {
			const idx = Math.round((n - 1) * f);
			const label = dates && dates[idx] ? fmtDate(dates[idx]) : String(idx + 1);
			ctx.fillText(label, geo.main.x + geo.main.w * f, tY);
		});
		ctx.textAlign = "left";
	};
	/* ---------- 长周期折线 ---------- */
	const drawLineS = (S: any, geo: any, it: any) => {
		const seq = S.d, dates = S.dates, n = seq.length;
		if (!n) return;
		const min = Math.min.apply(null, seq), max = Math.max.apply(null, seq), span = (max - min) || 1;
		const px = (i: number) => geo.main.x + (geo.main.w * i) / (n - 1);
		const py = (v: number) => geo.main.y + geo.main.h - ((v - min) / span) * geo.main.h;
		gridLine(py(it.prev), "#3a4150", [4, 4]);
		const col = dirC(it.pct);
		ctx.strokeStyle = col; ctx.lineWidth = 1.7;
		ctx.beginPath(); seq.forEach((v: number, i: number) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)))); ctx.stroke();
		if (S.est && n >= 2) {
			ctx.strokeStyle = col; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.arc(px(n - 1), py(seq[n - 1]), 3.5, 0, Math.PI * 2); ctx.stroke();
		}
		const g = ctx.createLinearGradient(0, geo.main.y, 0, geo.main.y + geo.main.h);
		g.addColorStop(0, col + "18"); g.addColorStop(1, "rgba(0,0,0,0)");
		ctx.lineTo(px(n - 1), geo.main.y + geo.main.h); ctx.lineTo(px(0), geo.main.y + geo.main.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
		drawYLabels(geo.main, min, max, S.isNav ? 3 : 2);
		ctx.fillStyle = "#5c6470"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
		const tY = geo.main.y + geo.main.h + 15;
		[0, 0.5, 1].forEach((f) => {
			const idx = Math.round((n - 1) * f);
			const label = dates && dates[idx] ? fmtDate(dates[idx]) : "";
			ctx.fillText(label, geo.main.x + geo.main.w * f, tY);
		});
		ctx.textAlign = "left";
	};
	/* ---------- 十字光标 ---------- */
	const showCross = (x: number, y: number) => {
		clearCross();
		ctxX.strokeStyle = "#6a7180"; ctxX.lineWidth = 1;
		ctxX.beginPath(); ctxX.moveTo(x, 0); ctxX.lineTo(x, cv.clientWidth); ctxX.stroke();
		ctxX.beginPath(); ctxX.moveTo(0, y); ctxX.lineTo(cv.clientWidth, y); ctxX.stroke();
	};
	const placeTip = (x: number, y: number) => {
		tip.classList.add("show");
		const rect = cv.getBoundingClientRect();
		let lx = x + 14, ly = y - 10;
		if (lx + 160 > rect.width) lx = x - 174;
		if (ly + 90 > rect.height) ly = y - 100;
		tip.style.left = lx + "px"; tip.style.top = ly + "px";
	};
	const handleMove = (e: MouseEvent) => {
		if (!curItem) return;
		if (dragState && dragState.moved) return;
		const rect = cv.getBoundingClientRect();
		const x = e.clientX - rect.left, y = e.clientY - rect.top;
		const S = series();
		if (S.kind === "empty" || !S.d) { tip.classList.remove("show"); clearCross(); return; }
		if (S.kind === "intraday") {
			const d = S.d, n = d.prices.length;
			const inMain = x >= geoR.padL && x <= geoR.padL + geoR.main.w && y >= geoR.main.y && y <= geoR.main.y + geoR.main.h;
			const inVol = x >= geoR.padL && x <= geoR.padL + geoR.main.w && y >= geoR.vol.y && y <= geoR.vol.y + geoR.vol.h;
			if (!n || (!inMain && !inVol)) { tip.classList.remove("show"); clearCross(); return; }
			const i = clamp(Math.round(((x - geoR.padL) / geoR.main.w) * (n - 1)), 0, n - 1);
			showCross(x, y);
			if (inMain) {
				setHtml(tip, '<div class="t1">' + d.times[i] + (S.estOnly ? " · 估值" : "") + '</div><div>价 ' + d.prices[i].toFixed(3) + '</div><div style="color:var(--yellow)">均价 ' + d.avg[i].toFixed(3) + '</div><div>量 ' + d.vols[i].toLocaleString() + "</div>");
			} else {
				setHtml(tip, '<div class="t1">' + d.times[i] + (S.estOnly ? " · 估值" : "") + '</div><div style="color:var(--yellow)">成交量 ' + d.vols[i].toLocaleString() + "</div>");
			}
			placeTip(x, y);
		} else if (S.kind === "k") {
			const d = S.d, n = d.length;
			const inMain = x >= geoR.padL && x <= geoR.padL + geoR.main.w && y >= geoR.main.y && y <= geoR.main.y + geoR.main.h;
			const inVol = x >= geoR.padL && x <= geoR.padL + geoR.main.w && y >= geoR.vol.y && y <= geoR.vol.y + geoR.vol.h;
			const inInd = x >= geoR.padL && x <= geoR.padL + geoR.main.w && y >= geoR.ind.y && y <= geoR.ind.y + geoR.ind.h;
			if (!n || (!inMain && !inVol && !inInd)) { tip.classList.remove("show"); clearCross(); return; }
			const i = clamp(Math.round(((x - geoR.padL) / geoR.main.w) * (n - 1)), 0, n - 1);
			showCross(x, y);
			const o = d[i];
			const dateStr = S.dates && S.dates[i] ? S.dates[i] : "";
			if (inMain) {
				setHtml(tip, '<div class="t1">' + rangeName() + " " + dateStr + "</div>" +
					"<div>开 " + o[0].toFixed(2) + "　收 <b style=\"color:" + dirC(o[1] - o[0]) + '">' + o[1].toFixed(2) + "</b></div>" +
					"<div>高 " + o[2].toFixed(2) + "　低 " + o[3].toFixed(2) + "</div><div>量 " + o[4].toLocaleString() + "</div>");
			} else if (inVol) {
				setHtml(tip, '<div class="t1">' + rangeName() + " " + dateStr + '</div><div style="color:var(--yellow)">成交量 ' + o[4].toLocaleString() + "</div>");
			} else {
				const sliceLen = Math.max(2, i + 1);
				const closes = d.slice(0, sliceLen).map((o2: any) => o2[1]);
				let indTxt = "";
				if (curInd === "macd") { const mm = macd(closes); const li = mm.dif.length - 1; indTxt = "MACD  DIF " + mm.dif[li].toFixed(3) + "  DEA " + mm.dea[li].toFixed(3) + "  柱 <b class=\"" + (mm.hist[li] >= 0 ? "up" : "down") + '">' + (mm.hist[li] >= 0 ? "+" : "") + mm.hist[li].toFixed(3) + "</b>"; }
				else if (curInd === "kdj") { const kk = kdj(d.slice(0, sliceLen)); const li = kk.k.length - 1; indTxt = "KDJ  K " + kk.k[li].toFixed(1) + "  D " + kk.d[li].toFixed(1) + "  J " + kk.j[li].toFixed(1); }
				else if (curInd === "rsi") { const rr = rsi(closes); const li = rr.length - 1; indTxt = "RSI(14)  " + rr[li].toFixed(1); }
				setHtml(tip, '<div class="t1">' + rangeName() + " " + dateStr + "</div><div>" + indTxt + "</div>");
			}
			placeTip(x, y);
		} else {
			const d = S.d, n = d.length;
			if (!n || x < geoR.padL || x > geoR.padL + geoR.main.w || y < geoR.main.y || y > geoR.main.y + geoR.main.h) { tip.classList.remove("show"); clearCross(); return; }
			const i = clamp(Math.round(((x - geoR.padL) / geoR.main.w) * (n - 1)), 0, n - 1);
			showCross(x, y);
			const dateStr = S.dates && S.dates[i] ? S.dates[i] : "";
			const navTxt = S.navType ? S.navType + "净值" : "收盘";
			setHtml(tip, '<div class="t1">' + rangeName() + " " + dateStr + '</div><div>' + navTxt + " " + d[i].toFixed(3) + "</div>" + (S.est && i === n - 1 ? '<div style="color:var(--yellow)">今日为盘中估值</div>' : ""));
			placeTip(x, y);
		}
	};
	cv.addEventListener("mousemove", handleMove);
	cv.addEventListener("mouseleave", () => { tip.classList.remove("show"); clearCross(); });
	cv.addEventListener("wheel", (e) => {
		if (!curItem) return;
		const s = rawSeries();
		if (s.kind === "intraday" || !s.d || !s.d.length) return;
		e.preventDefault();
		const total = s.d.length;
		let count = view.count == null ? total : view.count;
		count = clamp(Math.round(count * (e.deltaY < 0 ? 0.8 : 1.25)), 5, total);
		view.count = count; view.end = null;
		syncZoomUI(); renderChart();
	}, { passive: false });
	const dragMove = (e: MouseEvent) => {
		if (!dragState) return;
		const dx = e.clientX - dragState.x0;
		if (Math.abs(dx) > 2) dragState.moved = true;
		if (!dragState.moved) return;
		const s = rawSeries();
		const total = s.d ? s.d.length : 0;
		if (!total) return;
		const ppi = Math.max(1, geoR.main.w / dragState.count0);
		const delta = Math.round(dx / ppi);
		const end = clamp(dragState.end0 - delta, dragState.count0, total);
		view.count = dragState.count0; view.end = end;
		syncZoomUI(); renderChart();
	};
	cv.addEventListener("mousedown", (e) => {
		if (!curItem) return;
		const s = rawSeries();
		if (s.kind === "intraday") return;
		const total = s.d ? s.d.length : 0;
		if (!total) return;
		let count = view.count == null ? total : Math.min(view.count, total);
		count = Math.max(2, Math.min(count, total));
		if (count >= total) return;
		dragState = { x0: e.clientX, y0: e.clientY, end0: view.end == null ? total : view.end, count0: count, moved: false };
	});
	window.addEventListener("mousemove", dragMove);
	window.addEventListener("mouseup", () => { dragState = null; });
	cleanups.push(() => window.removeEventListener("mousemove", dragMove));

	/* ---------- 事件绑定 ---------- */
	$$(".nav-item").forEach((t) => t.onclick = () => {
		$$(".nav-item").forEach((x) => x.classList.remove("on")); t.classList.add("on");
		curNav = t.dataset.nav || "all";
		const nav = t.dataset.nav;
		if (nav === "all") renderAll();
		else if (nav === "groups") renderGroups();
		else renderHold();
	});
	$$(".chip").forEach((t) => t.onclick = () => {
		$$(".chip").forEach((x) => x.classList.remove("on")); t.classList.add("on");
		curType = t.dataset.type || "all"; renderAll();
	});
	$$(".c-tab[data-range]").forEach((t) => t.onclick = () => {
		curRange = t.dataset.range || "intraday"; view.count = null; view.end = null;
		syncTabClasses(); syncTabs(); renderChart();
		if (cmpOn) { curItem._bench = null; void loadBench(curItem); }
	});
	$$(".c-tab[data-ind]").forEach((t) => t.onclick = () => { curInd = t.dataset.ind || "none"; syncTabClasses(); renderChart(); });
	$("#btnRefresh").onclick = () => { renderChart(); renderCurrent(); const b = $("#btnRefresh"); b.textContent = "✓ 已刷新"; setTimeout(() => (b.textContent = "⟳ 刷新"), 1200); };
	$$("#colorSeg span").forEach((s) => s.onclick = () => {
		$$("#colorSeg span").forEach((x) => x.classList.remove("on")); s.classList.add("on");
		colorMode = s.dataset.c || "cn";
		(root.host as HTMLElement).style.setProperty("--up", upC());
		(root.host as HTMLElement).style.setProperty("--down", dnC());
		renderAll(); renderHold(); renderChart();
	});
	const onResize = () => { if (curItem) renderChart(); };
	window.addEventListener("resize", onResize);
	cleanups.push(() => window.removeEventListener("resize", onResize));

	/* ---------- 真实数据源（东财等；requestUrl；失败自动回落模拟） ---------- */
	const httpJson = async (url: string, referer?: string): Promise<any> => {
		if (typeof requestUrl !== "function") return null;
		const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
		for (let i = 0; i < 2; i++) {
			try {
				const r = await requestUrl({ url, throw: false, headers: { "User-Agent": UA, "Referer": referer || "https://www.eastmoney.com/", "Accept": "application/json,text/plain,*/*" } });
				if (r.status === 200) { const j = r.json; if (j) return j; }
			} catch { /* 重试一次 */ }
		}
		return null;
	};
	const httpText = async (url: string): Promise<string | null> => {
		if (typeof requestUrl !== "function") return null;
		try {
			const r = await requestUrl({ url, throw: false });
			if (r.status !== 200) return null;
			return r.text ?? null;
		} catch { return null; }
	};
	const scaleOf = (it: any): number => (isETF(it) || it.mkt === "hk" || it.mkt === "us") ? 1000 : 100;
	const secidOf = (it: any): string => {
		if (isETF(it)) return /^5/.test(it.code) ? "1." + it.code : "0." + it.code;
		if (it.secid) return it.secid;
		const c = it.code;
		if (it.mkt === "sh") return "1." + c;
		if (it.mkt === "sz") return "0." + c;
		if (it.mkt === "hk") return "116." + c;
		if (it.mkt === "us" || it.type === "us") return "105." + c;
		if (it.type === "stock") return /^6/.test(c) ? "1." + c : "0." + c;
		return "";
	};
	const closesOf = (arr: any[]): number[] => arr.map((o) => o[1]);
	const aggK = (arr: any[], n: number): any[] => {
		const out: any[] = [];
		for (let i = 0; i < arr.length; i += n) {
			const seg = arr.slice(i, i + n);
			out.push([seg[0][0], seg[seg.length - 1][1], Math.max.apply(null, seg.map((x) => x[2])), Math.min.apply(null, seg.map((x) => x[3])), seg.reduce((a, x) => a + x[4], 0)]);
		}
		return out;
	};
	const renderCurrent = () => { if (curNav === "all") renderAll(); else if (curNav === "groups") renderGroups(); else renderHold(); };
	const httpGBK = async (url: string, headers: Record<string, string> = {}): Promise<string | null> => {
		if (typeof requestUrl !== "function") return null;
		for (let i = 0; i < 2; i++) {
			try {
				const r = await requestUrl({ url, throw: false, headers });
				if (r.status !== 200) return null;
				const buf = (r as any).arrayBuffer;
				if (buf) { try { return new TextDecoder("gbk").decode(buf); } catch { return r.text ?? null; } }
				return r.text ?? null;
			} catch { /* 重试一次 */ }
		}
		return null;
	};
	const tencentSym = (it: any): string => {
		if (isETF(it)) return (/^5/.test(it.code) ? "sh" : "sz") + it.code;
		if (it.mkt === "hk") return "hk" + it.code;
		if (it.mkt === "sh") return "sh" + it.code;
		return "sz" + it.code;
	};
	const sinaSym = (it: any): string => { if (it.type === "us" || it.mkt === "us") return "gb_" + it.code.toLowerCase(); return tencentSym(it); };
	const quotesFromPush2 = async (stocks: any[]): Promise<boolean> => {
		const secids = stocks.map(secidOf).filter(Boolean).join(",");
		if (!secids) return false;
		const j = await httpJson("https://push2.eastmoney.com/api/qt/ulist.np/get?secids=" + secids + "&fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18");
		const diff: any[] = (j && j.data && j.data.diff) || [];
		if (!diff.length) return false;
		const map = new Map(diff.map((d: any) => [d.f13 + "." + d.f12, d]));
		let cnt = 0;
		stocks.forEach((it: any) => {
			const d = map.get(secidOf(it));
			if (!d || d.f2 == null || d.f2 === "-") return;
			const div = it._e3 ? 1000 : scaleOf(it);
			it.price = +(d.f2 / div).toFixed(3);
			if (d.f18 != null && d.f18 !== "-") it.prev = +(d.f18 / div).toFixed(3);
			if (d.f3 != null && d.f3 !== "-") it.pct = +(d.f3 / 100).toFixed(2);
			it.amt = +(it.price - it.prev).toFixed(3);
			if (d.f14) it.name = d.f14;
			it.stats = { 今开: +(d.f17 / div).toFixed(2), 最高: +(d.f15 / div).toFixed(2), 最低: +(d.f16 / div).toFixed(2), 昨收: it.prev, 成交量: "实时", 更新: "盘中" };
			cnt++;
		});
		return cnt > 0;
	};
	const quotesFromTencent = async (stocks: any[]): Promise<boolean> => {
		const qs = stocks.map((it: any) => it.type === "us" ? "us" + it.code : tencentSym(it)).join(",");
		if (!qs) return false;
		const txt = await httpGBK("https://qt.gtimg.cn/q=" + qs);
		if (!txt) return false;
		let cnt = 0;
		stocks.forEach((it: any) => {
			const sym = it.type === "us" ? "us" + it.code : tencentSym(it);
			const m = txt.match(new RegExp("v_" + sym + '="([^"]*)"'));
			if (!m) return;
			const a = m[1].split("~");
			if (!a[3] || isNaN(+a[3])) return;
			if (it.type === "us") {
				// 腾讯美股：a[3]=最新/a[4]=昨收 固定在前列；涨跌幅自算（后段字段长度不稳定）
				if (a[4] == null || isNaN(+a[4])) return;
				it.price = +(+a[3]).toFixed(3);
				it.prev = +(+a[4]).toFixed(3);
				it.pct = it.prev ? +((it.price - it.prev) / it.prev * 100).toFixed(2) : 0;
				it.amt = +(it.price - it.prev).toFixed(3);
				if (a[1]) it.name = a[1];
				it.stats = { 今开: a[5] && !isNaN(+a[5]) ? +(+a[5]).toFixed(2) : it.prev, 最高: a[33] && !isNaN(+a[33]) ? +(+a[33]).toFixed(2) : "—", 最低: a[34] && !isNaN(+a[34]) ? +(+a[34]).toFixed(2) : "—", 昨收: it.prev, 成交量: "实时", 更新: "盘中" };
			} else {
				it.price = +(+a[3]).toFixed(3);
				it.prev = +(+a[4]).toFixed(3);
				it.pct = +(+a[32]).toFixed(2);
				it.amt = +(it.price - it.prev).toFixed(3);
				if (a[1]) it.name = a[1];
				it.stats = { 今开: +(+a[5]).toFixed(2), 最高: +(+a[33]).toFixed(2), 最低: +(+a[34]).toFixed(2), 昨收: it.prev, 成交量: "实时", 更新: "盘中" };
			}
			cnt++;
		});
		return cnt > 0;
	};
	const quotesFromSina = async (stocks: any[]): Promise<boolean> => {
		const qs = stocks.map(sinaSym).join(",");
		if (!qs) return false;
		const txt = await httpGBK("https://hq.sinajs.cn/list=" + qs, { "Referer": "https://finance.sina.com.cn" });
		if (!txt) return false;
		let cnt = 0;
		stocks.forEach((it: any) => {
			const sym = sinaSym(it);
			const m = txt.match(new RegExp("hq_str_" + sym + '="([^"]*)"'));
			if (!m) return;
			const a = m[1].split(",");
			if (it.type === "us") {
				if (!a[1] || isNaN(+a[1])) return;
				it.price = +(+a[1]).toFixed(3); it.pct = +(+a[2]).toFixed(2); it.amt = 0;
				if (a[0]) it.name = a[0];
			} else if (it.mkt === "hk") {
				if (!a[6] || isNaN(+a[6])) return;
				it.price = +(+a[6]).toFixed(3); it.prev = +(+a[3]).toFixed(3);
				it.pct = it.prev ? +((it.price - it.prev) / it.prev * 100).toFixed(2) : it.pct;
				it.amt = +(it.price - it.prev).toFixed(3);
				if (a[1]) it.name = a[1];
				it.stats = { 今开: +(+a[2]).toFixed(2), 最高: +(+a[4]).toFixed(2), 最低: +(+a[5]).toFixed(2), 昨收: it.prev, 成交量: "实时", 更新: "盘中" };
			} else {
				if (!a[3] || isNaN(+a[3])) return;
				it.price = +(+a[3]).toFixed(3); it.prev = +(+a[2]).toFixed(3);
				it.pct = it.prev ? +((it.price - it.prev) / it.prev * 100).toFixed(2) : it.pct;
				it.amt = +(it.price - it.prev).toFixed(3);
				if (a[0]) it.name = a[0];
				it.stats = { 今开: +(+a[1]).toFixed(2), 最高: +(+a[4]).toFixed(2), 最低: +(+a[5]).toFixed(2), 昨收: it.prev, 成交量: "实时", 更新: "盘中" };
			}
			cnt++;
		});
		return cnt > 0;
	};
	let lastQuote = 0;
	let lastQuoteSig = "";
	const quoteSig = () => items.map((i: any) => i.code + "=" + (i.price ?? 0) + "," + (i.pct ?? 0) + "," + (i.est ? i.est.pct : "")).join("|");
	const refreshQuotes = async (force = false): Promise<void> => {
		if (!force && Date.now() - lastQuote < 30000) return;
		lastQuote = Date.now();
		const stocks = items.filter((i: any) => i.type !== "fund" || isETF(i));
		const funds = items.filter((i: any) => i.type === "fund" && !isETF(i));
		const usStocks = stocks.filter((i: any) => i.type === "us");
		const cnStocks = stocks.filter((i: any) => i.type !== "us");
		if (usStocks.length) {
			// 美股：优先腾讯/新浪（直接给真实价），东财 push2 缩放有歧义放最后
			let ugot = await quotesFromTencent(usStocks);
			if (!ugot) ugot = await quotesFromSina(usStocks);
			if (!ugot) await quotesFromPush2(usStocks);
		}
		if (cnStocks.length) {
			let got = await quotesFromPush2(cnStocks);
			if (!got) got = await quotesFromTencent(cnStocks);
			if (!got) await quotesFromSina(cnStocks);
		}
		if (funds.length) {
			const Fcodes = funds.map((i: any) => i.code).join(",");
			const j = await httpJson("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=10&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=Wap&Fcodes=" + Fcodes);
			const ds: any[] = (j && j.Datas) || [];
			ds.forEach((d: any) => {
				const it = funds.find((x: any) => x.code === d.FCODE);
				if (!it || d.NAV == null) return;
				const chg = d.NAVCHGRT != null ? +d.NAVCHGRT : 0;
				it.price = +(+d.NAV).toFixed(4);
				it.prev = +(it.price / (1 + chg / 100)).toFixed(4);
				it.pct = +chg.toFixed(2);
				it.amt = +(it.price - it.prev).toFixed(4);
				if (d.SHORTNAME) it.name = d.SHORTNAME;
				it.stats = Object.assign({}, it.stats, { 昨收: it.prev, 更新: "净值" });
				// 官方盘中估值（天天基金移动端 GSZ/GSZZL，交易时段有值；最优先）
				if (d.GSZZL != null && isFinite(+d.GSZZL) && +d.GSZZL !== 0) {
					const gszzl = +d.GSZZL;
					const gsz = d.GSZ != null && isFinite(+d.GSZ) && +d.GSZ > 0 ? +d.GSZ : +(it.price * (1 + gszzl / 100)).toFixed(4);
					it.est = { pct: +gszzl.toFixed(2), price: gsz, name: "官方估值" };
				}
			});
			// 盘中估值代理：指数基金 → 对应 ETF 实时价（官方估值已下线；走主/备/次备份链）
			const proxies = funds.filter((x: any) => x.proxy).map((x: any) => {
				const secid = x.proxy.secid; const code = secid.split(".")[1];
				const mkt = secid.startsWith("116") ? "hk" : secid.startsWith("1") ? "sh" : secid.startsWith("0") ? "sz" : "us";
				return { code, name: x.proxy.name, type: "stock", mkt, secid, _e3: true, price: 0, prev: 0, pct: 0 };
			});
			if (proxies.length) {
				let pgot = await quotesFromPush2(proxies);
				if (!pgot) pgot = await quotesFromTencent(proxies);
				if (!pgot) await quotesFromSina(proxies);
				funds.forEach((x: any) => {
					const pr = x.proxy; if (!pr) return;
					const pd = proxies.find((p: any) => p.secid === pr.secid);
					if (pd && pd.pct != null) x.est = { pct: pd.pct, price: pd.price, name: pr.name };
				});
			}
			// 主动基金自算估值（轻量刷新当前值）：仅对已缓存前十大重仓的基金，用重仓股实时行情加权
			const ownFunds = funds.filter((x: any) => !x.proxy && x._holdings && x._holdings.length);
			for (const f of ownFunds) {
				const hs = f._holdings;
				const ss = hs.map((h: any) => ({ code: h.code, name: h.name, type: "stock", mkt: h.mkt, secid: h.secid, price: 0, prev: 0, pct: 0 }));
				let sgot = await quotesFromPush2(ss);
				if (!sgot) sgot = await quotesFromTencent(ss);
				if (!sgot) await quotesFromSina(ss);
				const lastNav = (f._real && f._real.navUnit && f._real.navUnit.length) ? f._real.navUnit[f._real.navUnit.length - 1] : (f.prev || f.price || 1);
				const pct2 = estPctFromStocks(hs, ss);
				if (pct2 != null) f.est = { pct: pct2, price: +(lastNav * (1 + pct2 / 100)).toFixed(4), name: "自算估值·前十大重仓" };
			}
		}
		const ns = quoteSig();
		if (force || ns !== lastQuoteSig) {
			lastQuoteSig = ns;
			if (curItem) renderDetail();
			renderCurrent(); renderChart();
		}
	};
	/* ---------- 美股历史数据（腾讯 usfqkline / 新浪全量+自算前复权）备用 ---------- */
	const tencentUsSym = (it: any, suffix: string): string => "us" + it.code + suffix;
	const parseTencentK = (arr: string[][]): string[] => arr.map((b: string[]) => b.join(","));
	const fetchTencentUsKline = async (it: any): Promise<string[]> => {
		for (const suffix of [".OQ", ".N"]) {
			const tk = await httpJson("https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=" + tencentUsSym(it, suffix) + ",day,,,1000,qfq", "https://gu.qq.com/");
			const tdata = tk && tk.data && tk.data[tencentUsSym(it, suffix)];
			const tarr: string[][] = (tdata && (tdata.qfqday || tdata.day)) || [];
			if (tarr.length >= 60) return parseTencentK(tarr);
		}
		return [];
	};
	const isNearSplitRatio = (g: number): boolean => [2, 3, 4, 5, 10, 20, 25, 50].some((c) => Math.abs(g - c) / c < 0.12);
	// 新浪美股全量日K（不复权）→ 自动识别拆股（跳空+放量）→ 自算前复权（与当前价对齐）
	const fetchSinaUsKline = async (it: any): Promise<string[]> => {
		const txt = await httpTextH("https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20x=/US_MinKService.getDailyK?symbol=" + encodeURIComponent(it.code), { "Referer": "https://finance.sina.com.cn/" });
		if (!txt) return [];
		const s0 = txt.indexOf("([");
		if (s0 < 0) return [];
		const e0 = txt.lastIndexOf("])");
		let rows: any[] = [];
		try { rows = JSON.parse(txt.slice(s0 + 1, e0 + 1)); } catch { return []; }
		if (!rows.length) return [];
		const adj = rows.map((x: any) => ({ d: x.d, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v }));
		const splits: number[] = [];
		for (let i = 1; i < adj.length; i++) {
			const prevC = adj[i - 1].c, curO = adj[i].o;
			if (prevC <= 0 || curO <= 0) continue;
			const gap = prevC / curO;
			if (gap > 1.25 && isNearSplitRatio(gap)) {
				const vAvg = adj.slice(Math.max(0, i - 5), i).reduce((a, x) => a + x.v, 0) / Math.min(5, i);
				if (adj[i].v > vAvg * 1.8 && adj[i].v > (adj[i - 1].v || 0) * 1.5) splits.push(i);
			}
		}
		const factor = new Array(adj.length).fill(1);
		for (const si2 of splits) for (let i = 0; i < si2; i++) factor[i] *= (1 / (adj[si2 - 1].c / adj[si2].o));
		return adj.map((r: any, i: number) => {
			const f = factor[i];
			return [r.d, +(r.o * f).toFixed(4), +(r.c * f).toFixed(4), +(r.h * f).toFixed(4), +(r.l * f).toFixed(4), Math.round(r.v)].join(",");
		});
	};
	const httpTextH = async (url: string, headers: Record<string, string> = {}): Promise<string | null> => {
		if (typeof requestUrl !== "function") return null;
		try {
			const r = await requestUrl({ url, throw: false, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", ...headers } });
			if (r.status !== 200) return null;
			return r.text ?? null;
		} catch { return null; }
	};
	/* ---------- 分时（当日）真实数据：东财标准分时 trends2（akshare 同款）→ 分钟K线备用 ---------- */
	const fetchIntraday = async (secid: string): Promise<{ times: string[]; prices: number[]; vols: number[]; avg: number[] } | null> => {
		const isUs = secid.startsWith("105.") || secid.startsWith("106.") || secid.startsWith("107.");
		// 1) A股/港股：腾讯 minute/query（稳定完整分时，含成交额 → 精确均价线）
		if (!isUs) {
			const code = secid.split(".")[1];
			const txCode = secid.startsWith("116.") ? "hk" + code : (secid.startsWith("1.") ? "sh" : "sz") + code;
			const tk = await httpJson("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + txCode, "https://gu.qq.com/");
			const inner: string[] = (tk && tk.data && tk.data[txCode] && tk.data[txCode].data && tk.data[txCode].data.data) || [];
			if (inner.length >= 10) {
				const times: string[] = [], prices: number[] = [], vols: number[] = [], amts: number[] = [];
				for (const s of inner) {
					const a = String(s).trim().split(/\s+/);
					const price = +a[1];
					if (a.length < 3 || isNaN(price)) continue;
					const hm = a[0];
					times.push(hm.length === 4 ? hm.slice(0, 2) + ":" + hm.slice(2) : hm);
					prices.push(price);
					vols.push(Math.round(+a[2] || 0));
					amts.push(+a[3] || 0);
				}
				if (prices.length >= 10) {
					const avg: number[] = [];
					let cA = 0, cV = 0;
					for (let i = 0; i < prices.length; i++) { cA += amts[i]; cV += vols[i]; avg.push(cV ? +(cA / cV).toFixed(3) : prices[i]); }
					return { times, prices, vols, avg };
				}
			}
		}
		// 2) 东财标准分时 trends2（akshare 同款；美股主源用 ndays=5 并取最近交易日）
		const host = "https://push2his.eastmoney.com";
		const tUrl = host + "/api/qt/stock/trends2/get?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=" + (isUs ? "5" : "1") + (isUs ? "" : "&ut=7eea3edcaed734bea9cbfc24409ed989") + "&secid=" + secid;
		const t = await httpJson(tUrl, "https://quote.eastmoney.com/");
		let trends: string[] = (t && t.data && t.data.trends) || [];
		if (isUs && trends.length) {
			const lastDate = trends[trends.length - 1].split(",")[0].slice(0, 10);
			trends = trends.filter((s: string) => s.split(",")[0].slice(0, 10) === lastDate);
		}
		if (trends.length >= 2) {
			const times: string[] = [], prices: number[] = [], vols: number[] = [], amts: number[] = [];
			for (const s of trends) {
				const a = s.split(",");
				const price = +a[2];
				if (a.length < 6 || isNaN(price)) continue;
				times.push(a[0].length >= 16 ? a[0].slice(11, 16) : a[0].slice(0, 5));
				prices.push(price);
				vols.push(Math.round(+a[5] || 0));
				amts.push(+a[6] || 0);
			}
			if (prices.length >= 2) {
				const avg: number[] = [];
				let cA = 0, cV = 0;
				for (let i = 0; i < prices.length; i++) { cA += amts[i]; cV += vols[i]; avg.push(cV ? +(cA / cV).toFixed(3) : prices[i]); }
				return { times, prices, vols, avg };
			}
		}
		// 3) 备用：分钟K线（klt=1，beg=0 必需；lmt=480 覆盖美股完整时段）
		const m = await httpJson(host + "/api/qt/stock/kline/get?secid=" + secid + "&klt=1&fqt=1&beg=0&end=20500000&lmt=480&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57");
		const ml: string[] = (m && m.data && m.data.klines) || [];
		if (ml.length) {
			const prices = ml.map((s: string) => +s.split(",")[2]);
			const vols = ml.map((s: string) => +s.split(",")[5]);
			const times = ml.map((s: string) => s.split(",")[0].slice(11, 16));
			let c1 = 0, c2 = 0;
			const avg = prices.map((p, i) => { c1 += p * vols[i]; c2 += vols[i]; return +(c1 / c2).toFixed(3); });
			return { times, prices, vols, avg };
		}
		return null;
	};
	const fetchSeries = async (it: any): Promise<void> => {
		if (it._loading) return;
		if (it._real && it._real.fetchedAt && Date.now() - it._real.fetchedAt < 60000) {
			if (curItem === it) renderChart();
			return;
		}
		it._loading = true;
		try {
			const secid = secidOf(it);
			if (secid && (it.type !== "fund" || isETF(it))) {
				// —— 日K线：东财 push2his（akshare 同款参数：不带 beg、lmt=1000000、带编号子域）——
				const EM_HOSTS = ["https://63.push2his.eastmoney.com", "https://push2his.eastmoney.com"];
				const fetchK = async (fqt: number): Promise<string[]> => {
					for (const host of EM_HOSTS) {
						const k = await httpJson(host + "/api/qt/stock/kline/get?secid=" + secid + "&klt=101&fqt=" + fqt + "&end=20500000&lmt=1000000&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
						const kl = (k && k.data && k.data.klines) || [];
						if (kl.length) return kl;
					}
					return [];
				};
				const klineSpanOK = (kl: string[]): boolean => {
					if (!kl || kl.length < 60) return false;
					const d0 = kl[0].split(",")[0], d1 = kl[kl.length - 1].split(",")[0];
					if (!d0 || !d1 || d0 >= d1) return false;
					if ((Date.parse(d1) - Date.parse(d0)) < 31536000000) return false; // 跨度 < 1 年视为异常
					const closes = kl.map((s: string) => +s.split(",")[2]).filter((v: number) => !isNaN(v));
					if (closes.length < 60) return false;
					const mn = Math.min.apply(null, closes), mx = Math.max.apply(null, closes);
					if (mx / Math.max(mn, 1e-6) < 1.03) return false; // 历史价趋同当前价（东财美股异常特征）→ 判失败
					return true;
				};
				let kl: string[] = [];
				const isUS = it.type === "us" || it.mkt === "us";
				if (isUS) {
					// 美股：东财 qfq/hfq/不复权 → 腾讯 usfqkline（前复权，约4年） → 新浪全量+自算前复权
					for (const fqt of [1, 2, 0]) {
						const kk = await fetchK(fqt);
						if (klineSpanOK(kk)) { kl = kk; break; }
					}
					if (!klineSpanOK(kl)) {
						const tk = await fetchTencentUsKline(it);
						if (klineSpanOK(tk)) kl = tk;
					}
					if (!klineSpanOK(kl)) {
						const sn = await fetchSinaUsKline(it);
						if (sn.length) kl = sn;
					}
				} else {
					kl = await fetchK(1);
					if (!kl.length && (it.mkt === "sh" || it.mkt === "sz" || it.mkt === "hk")) {
						const tk = await httpJson("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + tencentSym(it) + ",day,,,1250,qfq");
						const tdata = tk && tk.data && tk.data[tencentSym(it)];
						const tarr: string[][] = (tdata && (tdata.qfqday || tdata.day)) || [];
						if (tarr.length) kl = tarr.map((b: string[]) => b.join(","));
					}
				}
				if (kl.length) {
					const dk = kl.map((s: string) => { const a = s.split(","); return [+a[1], +a[2], +a[3], +a[4], Math.round(+a[5])]; });
					it._real = it._real || {};
					it._real.dk = dk;
					it._real.wk = aggK(dk, 5);
					it._real.mk = aggK(dk, 22);
					it._real.m1 = closesOf(dk).slice(-30);
					it._real.y1 = closesOf(dk).slice(-250);
					it._real.y3 = closesOf(dk).slice(-750);
					it._real.y5 = closesOf(dk);
					const dkDates = kl.map((s: string) => s.split(",")[0]);
					it._real.dts = { dk: dkDates, wk: aggDates(dkDates, 5), mk: aggDates(dkDates, 22), m1: dkDates.slice(-30), y1: dkDates.slice(-250), y3: dkDates.slice(-750), y5: dkDates };
				}
				// 分时（当日）：标准分时 trends2 → 分钟K线(klt=1&beg=0) 备用
				const intra = await fetchIntraday(secid);
				if (intra) it._real.intraday = intra;
			} else if (isOffFund(it)) {
				const txt = await httpText("https://fund.eastmoney.com/pingzhongdata/" + it.code + ".js");
				const mu = txt ? txt.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/) : null;
				const ma = txt ? txt.match(/Data_accumulatedNetWorthTrend\s*=\s*(\[[\s\S]*?\]);/) : null;
				if (mu || ma) {
					const uArr: Array<{ x: number; y: number }> = mu ? JSON.parse(mu[1]) : [];
					const aArr: Array<{ x: number; y: number }> = ma ? JSON.parse(ma[1]) : [];
					const src = uArr.length ? uArr : aArr;
					const navUnit = uArr.length ? uArr.map((p) => +p.y) : [];
					const navAcc = aArr.length ? aArr.map((p) => +p.y) : navUnit;
					const dkDates = src.map((p) => { const dd = new Date(p.x); return dd.getFullYear() + "-" + pad2(dd.getMonth() + 1) + "-" + pad2(dd.getDate()); });
					const dk = navUnit.map((v) => [+v, +v, +v, +v, 0]);
					it._real = it._real || {};
					it._real.navUnit = navUnit; it._real.navAcc = navAcc; it._real.navDates = dkDates;
					it._real.dk = dk;
					it._real.wk = aggK(dk, 5);
					it._real.mk = aggK(dk, 22);
					it._real.m1 = navUnit.slice(-30);
					it._real.y1 = navUnit.slice(-250);
					it._real.y3 = navUnit.slice(-750);
					it._real.y5 = navUnit;
					it._real.dts = { dk: dkDates, wk: dkDates, mk: dkDates, m1: dkDates.slice(-30), y1: dkDates.slice(-250), y3: dkDates.slice(-750), y5: dkDates };
				}
				// 盘中估值：不依赖净值接口是否成功（lastNav 用已有净值/价格兜底）
				await loadEstCurve(it, (it._real && it._real.navUnit) || []);
			}
		} catch (e: any) { if (it) it._estErr = "数据获取异常"; }
		if (it._real) it._real.fetchedAt = Date.now();
		dataVersion++;
		it._loading = false;
		if (curItem === it) renderChart();
	};
	/* ---------- 主动基金自算盘中估值：官方季报前十大重仓 × 重仓股实时行情加权（真实数据，非模拟） ---------- */
	/* ---------- 指数基金盘中估值：用跟踪指数的实时分时（不依赖持仓接口） ---------- */
	// 常见公募基金跟踪指数 → 腾讯指数代码（指数基金盘中估值用；名称来自基金页"跟踪标的"，代码用于腾讯分时）
	const INDEX_TX_MAP: Record<string, string> = {
		"沪深300": "sh000300", "中证500": "sh000905", "中证1000": "sh000852", "中证800": "sh000906",
		"上证50": "sh000016", "上证180": "sh000010", "中证红利": "sh000922", "中证环保": "sh000827",
		"创业板指": "sz399006", "创业板50": "sz399673", "中证酒": "sz399987", "中证白酒": "sz399997",
		"中证食品饮料": "sz399396", "中证医疗": "sz399989", "中证医药": "sh000933", "中证创新药": "sz399813",
		"中证新能源": "sz399808", "中证军工": "sz399967", "中证证券": "sz399975", "中证银行": "sz399986",
		"中证煤炭": "sz399998", "中证钢铁": "sz399984", "中证有色": "sh000819", "中证房地产": "sz399962",
		"中证传媒": "sz399971", "中证半导体": "sz399995", "中证芯片": "sh000698", "中证人工智能": "sh930713",
		"中证智能汽车": "sh930721", "中证5G通信": "sh931079", "中证云计算": "sh930851", "中证新能源车": "sz399976",
		"中证光伏": "sh931151", "中证电池": "sh931719", "中证主要消费": "sh000932", "中证可选消费": "sh000989",
		"恒生指数": "hkHSI", "恒生科技": "hkHSTECH", "恒生中国企业": "hkHSCEI",
		"纳斯达克100": "usNDX", "标普500": "usINX", "道琼斯": "usDJI", "纳斯达克": "usIXIC",
	};
	const fetchFundIndex = async (it: any): Promise<string | null> => {
		if (it._indexTx !== undefined) return it._indexTx;
		let tx: string | null = null;
		let name: string | null = null;
		// 1) 主源：基金档案接口（INDEXCODE，数字）
		try {
			const j = await httpJson("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation?FCODE=" + it.code + "&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8", "https://mpservice.eastmoney.com/");
			const c = j && j.Datas && j.Datas.INDEXCODE;
			if (c && c !== "--" && c !== "-" && /^\d{6}$/.test(String(c))) {
				const code = String(c);
				tx = (code.startsWith("399") ? "sz" : "sh") + code;
				name = (j.Datas && j.Datas.INDEXNAME) || "";
			}
		} catch { /* 尝试下一源 */ }
		// 2) 备用：基金页"跟踪标的"名称 → 内置指数映射（不依赖档案接口）
		if (!tx) {
			try {
				const html = await httpTextH("https://fund.eastmoney.com/" + it.code + ".html", { "Referer": "https://fund.eastmoney.com/" });
				if (html) {
					const m = html.match(/跟踪标的[：:]\s*(?:<[^>]*>)?([^<\s]{2,24})/);
					if (m) {
						const nm = m[1].trim();
						const key = Object.keys(INDEX_TX_MAP).find((k) => nm.includes(k) || k.includes(nm));
						if (key) { tx = INDEX_TX_MAP[key]; name = nm; }
					}
				}
			} catch { /* 无指数信息 */ }
		}
		it._indexTx = tx;
		it._indexName = name || "跟踪指数";
		return tx;
	};
	const fetchIndexIntraday = async (txCode: string): Promise<{ times: string[]; prices: number[]; vols: number[]; avg: number[]; prev: number } | null> => {
		// 指数昨收（腾讯行情 a[4]）
		let prev = 0;
		const q = await httpGBK("https://qt.gtimg.cn/q=" + txCode);
		if (q) {
			const m = q.match(new RegExp("v_" + txCode + '="([^"]*)"'));
			if (m) { const a = m[1].split("~"); prev = +a[4] || 0; }
		}
		// 指数当日分时（腾讯 minute/query）
		const tk = await httpJson("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + txCode, "https://gu.qq.com/");
		const inner: string[] = (tk && tk.data && tk.data[txCode] && tk.data[txCode].data && tk.data[txCode].data.data) || [];
		if (inner.length >= 10) {
			const times: string[] = [], prices: number[] = [], vols: number[] = [], amts: number[] = [];
			for (const s of inner) {
				const a = String(s).trim().split(/\s+/);
				const price = +a[1];
				if (a.length < 3 || isNaN(price)) continue;
				const hm = a[0];
				times.push(hm.length === 4 ? hm.slice(0, 2) + ":" + hm.slice(2) : hm);
				prices.push(price);
				vols.push(Math.round(+a[2] || 0));
				amts.push(+a[3] || 0);
			}
			if (prices.length >= 10) {
				const avg: number[] = [];
				let cA = 0, cV = 0;
				for (let i = 0; i < prices.length; i++) { cA += amts[i]; cV += vols[i]; avg.push(cV ? +(cA / cV).toFixed(3) : prices[i]); }
				return { times, prices, vols, avg, prev };
			}
		}
		return null;
	};
	const fetchFundHoldings = async (it: any): Promise<any[]> => {
		// 主源：天天基金 F10 季报股票明细（akshare 同款接口；取最新季度、按占净值比例取前十大）
		const now = new Date();
		const q0 = Math.floor(now.getMonth() / 3);
		for (let k = 0; k < 3; k++) {
			let q = q0 - k, yr = now.getFullYear();
			if (q < 0) { q += 4; yr -= 1; }
			const mo = q * 3 + 1;
			const txt = await httpTextH("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=" + it.code + "&topline=100&year=" + yr + "&month=" + mo, { "Referer": "https://fundf10.eastmoney.com/" });
			if (!txt) continue;
			const cm = txt.match(/content:"([\s\S]*?)",\s*arryear/);
			if (!cm) continue;
			const boxes = cm[1].split("<div class='box'>").slice(1);
			if (!boxes.length) continue;
			const rows = boxes[0].match(/<tr>[\s\S]*?<\/tr>/g) || []; // 最新季度 section
			const hs: any[] = [];
			for (const row of rows.slice(1)) {
				const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
				if (!cells || cells.length < 7) continue;
				const linkM = cells[1].match(/r\/(\d)\.(\d{6})/);
				const name = cells[2].replace(/<[^>]+>/g, "").trim();
				const ratio = parseFloat(cells[6].replace(/<[^>]+>/g, "").replace(/%/g, "").trim());
				if (!linkM || !name || !isFinite(ratio) || ratio <= 0) continue;
				hs.push({ code: linkM[2], name, ratio, mkt: linkM[1] === "1" ? "sh" : "sz", secid: (linkM[1] === "1" ? "1." : "0.") + linkM[2] });
			}
			hs.sort((a: any, b: any) => b.ratio - a.ratio);
			if (hs.length) return hs.slice(0, 10);
		}
		// 备源：天天基金移动端持仓接口（含占净值比例）
		try {
			const j = await httpJson("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=" + it.code + "&pageIndex=1&pageSize=10&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=Wap", "https://mpservice.eastmoney.com/");
			const arr: any[] = (j && j.Datas && j.Datas.fundStocks) || [];
			const hs = arr.map((s: any) => {
				const tex = String(s.TEXCH);
				if (tex !== "1" && tex !== "2") return null;
				return { code: s.GPDM, name: s.GPJC, ratio: +s.JZBL || 0, mkt: tex === "1" ? "sh" : "sz", secid: (tex === "1" ? "1." : "0.") + s.GPDM };
			}).filter((h: any) => h && h.code && h.ratio > 0);
			if (hs.length) return hs.slice(0, 10);
		} catch { /* 两个源都失败 */ }
		return [];
	};
	const estPctFromStocks = (holds: any[], stocks: any[]): number | null => {
		let wPct = 0, wOk = 0;
		holds.forEach((h: any, i: number) => {
			const s = stocks[i];
			if (s && s.pct != null && isFinite(s.pct)) { wPct += s.pct * h.ratio; wOk += h.ratio; }
		});
		return wOk > 0 ? +(wPct / wOk).toFixed(2) : null;
	};
	const calcOwnEstimate = async (it: any, lastNav: number): Promise<void> => {
		it._estErr = "";
		try {
			let holds = it._holdings;
			if (!holds || !(it._holdingsTs && Date.now() - it._holdingsTs < 86400000)) {
				holds = await fetchFundHoldings(it);
				it._holdings = holds;
				it._holdingsTs = Date.now();
				saveMoney(); // 持仓缓存到本地（季报持仓，一天内不重复拉）
			}
			if (!holds.length) { it._estErr = "未取到前十大重仓（持仓接口无数据）"; return; }
			// 1) 重仓股实时行情 → 当前估算
			const stocks = holds.map((h: any) => ({ code: h.code, name: h.name, type: "stock", mkt: h.mkt, secid: h.secid, price: 0, prev: 0, pct: 0 }));
			let got = await quotesFromPush2(stocks);
			if (!got) got = await quotesFromTencent(stocks);
			if (!got) await quotesFromSina(stocks);
			const pct = estPctFromStocks(holds, stocks);
			if (pct != null) {
				it.est = { pct, price: +(lastNav * (1 + pct / 100)).toFixed(4), name: "自算估值·前十大重仓" };
			} else {
				it._estErr = "重仓股实时行情获取失败";
			}
			// 2) 重仓股分时（并发）→ 合成"当日估算净值曲线"（真实分时×真实权重）
			const results = await Promise.all(holds.map(async (h: any) => {
				const s = stocks[holds.indexOf(h)];
				const intra = await fetchIntraday(h.secid).catch(() => null);
				return { h, s, intra };
			}));
			const okR = results.filter((r: any) => r.intra && r.intra.prices.length >= 2);
			if (okR.length) {
				const n = Math.max.apply(null, okR.map((r: any) => r.intra.prices.length));
				const times = okR[0].intra.times;
				const prices: number[] = [], vols: number[] = [];
				for (let t = 0; t < n; t++) {
					let wP = 0, wV = 0, wVol = 0;
					for (const r of okR) {
						const idx = Math.min(t, r.intra.prices.length - 1);
						const v = r.intra.prices[idx];
						const prev = (r.s && r.s.prev) || r.intra.prices[0];
						if (prev && v) { wP += (v / prev - 1) * 100 * r.h.ratio; wV += r.h.ratio; }
						wVol += (r.intra.vols[idx] || 0) * r.h.ratio;
					}
					prices.push(+(lastNav * (1 + (wV ? wP / wV : 0) / 100)).toFixed(4));
					vols.push(Math.round(wVol));
				}
				let c1 = 0, c2 = 0;
				const avg = prices.map((p: number, i: number) => { c1 += p * (vols[i] || 1); c2 += (vols[i] || 1); return +(c1 / c2).toFixed(4); });
				it._real!.estCurve = { times, prices, vols, avg };
			} else if (!it.est) {
				it._estErr = "重仓股分时获取失败";
			}
		} catch (e: any) {
			it._estErr = "自算估值异常";
		}
	};
	const loadEstCurve = async (it: any, navUnit: number[]): Promise<void> => {
		const lastNav = navUnit.length ? navUnit[navUnit.length - 1] : (it.prev || it.price || 1);
		it._estErr = "";
		// 1) 指数基金（有跟踪指数）：直接用指数实时分时估算（比持仓自算更准，且不依赖持仓接口）
		const idxCode = await fetchFundIndex(it);
		if (idxCode) {
			const ix = await fetchIndexIntraday(idxCode);
			if (ix && ix.prices.length >= 2 && ix.prev) {
				const prices = ix.prices.map((v: number) => +(lastNav * (v / ix.prev)).toFixed(4));
				let c1 = 0, c2 = 0;
				const avg = prices.map((p: number, i: number) => { c1 += p * (ix.vols[i] || 1); c2 += (ix.vols[i] || 1); return +(c1 / c2).toFixed(4); });
				it._real!.estCurve = { times: ix.times, prices, vols: ix.vols, avg };
				// 同步当前估值（详情卡）
				const last = prices[prices.length - 1];
				it.est = { pct: +((last / lastNav - 1) * 100).toFixed(2), price: last, name: "指数估算·" + (it._indexName || "跟踪指数") };
				return;
			}
			it._estErr = "跟踪指数分时获取失败";
			return;
		}
		// 2) 有代理（指数基金/ETF联接）：用对应 ETF 的实时分时缩放
		if (it.proxy) {
			const intra = await fetchIntraday(it.proxy.secid);
			if (!intra || !intra.prices.length) { it._estErr = "代理ETF分时获取失败"; return; }
			const est = it.est;
			const proxyPrev = est && est.price ? +(est.price / (1 + (est.pct || 0) / 100)).toFixed(4) : (intra.prices[0] || lastNav);
			const ratio = proxyPrev ? lastNav / proxyPrev : 1;
			const prices = intra.prices.map((p: number) => +(p * ratio).toFixed(4));
			let c1 = 0, c2 = 0;
			const avg = prices.map((p: number, i: number) => { c1 += p * intra.vols[i]; c2 += intra.vols[i]; return +(c1 / c2).toFixed(4); });
			it._real!.estCurve = { times: intra.times, prices, vols: intra.vols, avg };
			return;
		}
		// 3) 主动基金（无指数、无代理）：用官方季报前十大重仓 × 实时行情自算
		await calcOwnEstimate(it, lastNav);
	};

	/* ---------- 启动 ---------- */
	const bump = () => {
		void refreshQuotes();
	};
	const timer = window.setInterval(() => { if (document.visibilityState === "visible") bump(); }, 20000);
	timers.push(timer);

	renderAll(); renderHold();
	if (items.length) selectItem(items[0]); else { curItem = null; renderDetail(); renderChart(); }
	void refreshQuotes(true);
	void refreshIndices();
}
