import { useEffect, useState } from "react";
import { cn, fmtChange, fmtQuote } from "@/lib/utils";
import type { FinanceHeadline, MarketQuote } from "@/data/types";
import { DebtClock } from "./debt-clock";

function Sep() {
  return <span className="px-2.5 text-faint/70">·</span>;
}

function Tape({
  wxLabel,
  quotes,
  headlines,
}: {
  wxLabel?: string;
  quotes: MarketQuote[];
  headlines: FinanceHeadline[];
}) {
  return (
    <div className="flex items-center whitespace-nowrap">
      {wxLabel ? (
        <>
          <span className="font-mono text-[10px] tracking-widest text-faint uppercase">{wxLabel}</span>
          <Sep />
        </>
      ) : null}
      {quotes.map((q) => {
        const up = q.change >= 0;
        return (
          <span
            key={q.id}
            className={cn(
              "mr-3 inline-flex items-baseline gap-1.5 font-mono text-[11px] tabular tracking-wide",
              up ? "text-flow" : "text-hot",
            )}
          >
            <span className="text-faint">{q.label}</span>
            <span>{fmtQuote(q.value, q.digits, q.suffix)}</span>
            <span>{fmtChange(q.change, q.digits, q.suffix)}</span>
          </span>
        );
      })}
      {quotes.length ? <Sep /> : null}
      <DebtClock />
      {headlines.length ? <Sep /> : null}
      {headlines.map((it, i) => (
        <span key={it.id} className="inline-flex items-center">
          {i > 0 ? <Sep /> : null}
          <a
            href={it.href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-muted hover:text-fg"
          >
            <span className="text-faint uppercase">{it.source} </span>
            {it.headline}
          </a>
        </span>
      ))}
      <span className="w-10 shrink-0" aria-hidden="true" />
    </div>
  );
}

export function NewsTicker({ wxLabel }: { wxLabel?: string }) {
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [headlines, setHeadlines] = useState<FinanceHeadline[]>([]);

  useEffect(() => {
    let live = true;
    const loadMarkets = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/markets")
        .then((r) => r.json())
        .then((d: { quotes?: MarketQuote[] }) => {
          if (live) setQuotes(d.quotes ?? []);
        })
        .catch(() => undefined);
    };
    const loadNews = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/finance-news")
        .then((r) => r.json())
        .then((d: { items?: FinanceHeadline[] }) => {
          if (live) setHeadlines(d.items ?? []);
        })
        .catch(() => undefined);
    };
    loadMarkets();
    loadNews();
    const m = window.setInterval(loadMarkets, 60_000);
    const n = window.setInterval(loadNews, 180_000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        loadMarkets();
        loadNews();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearInterval(m);
      window.clearInterval(n);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const ready = quotes.length || headlines.length || wxLabel;
  if (!ready) {
    return <div className="h-6 w-full animate-pulse bg-elevated/80" />;
  }

  const props = { wxLabel, quotes, headlines };

  return (
    <div
      className="ticker-track border-b border-line bg-bg-2"
      role="marquee"
      aria-label="Markets, U.S. debt, and finance headlines"
      title="Markets, debt, and headlines — hover to pause"
    >
      <div className="ticker-crawl">
        <Tape {...props} />
        <Tape {...props} />
      </div>
    </div>
  );
}
