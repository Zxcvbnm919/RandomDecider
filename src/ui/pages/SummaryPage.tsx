import { useState } from 'react'
import { formatTime } from '../components'
import { store, useStore } from '../store'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      return true
    } catch {
      return false
    }
  }
}

export default function SummaryPage() {
  const state = useStore()
  const session = state.session
  const summary = session?.summary
  const [copied, setCopied] = useState(false)

  if (!session || !summary) {
    return (
      <div className="focus-page">
        <div className="empty">
          <h3>没有可展示的结果</h3>
          <button className="btn primary" onClick={() => store.navigate({ name: 'main' })}>
            返回主界面
          </button>
        </div>
      </div>
    )
  }

  const finalLine = `最终结果：${summary.finalChain.join(' → ')}`

  const copy = async () => {
    const ok = await copyText(finalLine)
    if (ok) {
      setCopied(true)
      store.toast('已复制最终结果')
      setTimeout(() => setCopied(false), 1500)
    } else {
      store.toast('复制失败，请手动选择文本')
    }
  }

  return (
    <div className="focus-page summary-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={() => store.exitSession()} aria-label="返回">
          ‹
        </button>
        <div className="focus-title">
          <h1>本次结果</h1>
          <p className="muted">
            {summary.rootName} · {formatTime(summary.time)}
          </p>
        </div>
      </header>

      <div className="summary-scroll">
        <section className="summary-hero">
          <div className="summary-label">最终结果</div>
          <div className="summary-chain">
            {summary.finalChain.map((value, index) => (
              <span key={`${value}-${index}`} className="chain-item">
                {value}
                {index < summary.finalChain.length - 1 ? (
                  <span className="chain-arrow">→</span>
                ) : null}
              </span>
            ))}
          </div>
          <button className="btn" onClick={() => void copy()}>
            {copied ? '已复制' : '复制文本'}
          </button>
        </section>

        {summary.manualParts.length > 0 ? (
          <section className="summary-block">
            <h2>手动选择的部分</h2>
            <p>{summary.manualParts.join('、')}</p>
          </section>
        ) : null}

        <section className="summary-block">
          <h2>被替换的结果</h2>
          <div className="replaced-list">
            {summary.replacedByLevel.map((item) => (
              <div className="replaced-row" key={item.level}>
                <span className="muted">第 {item.level} 级</span>
                <span>{item.names.length ? item.names.join('；') : '-'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="summary-block">
          <h2>逐级结果</h2>
          <div className="summary-levels">
            {summary.levels.map((level) => (
              <div className="summary-level" key={level.level}>
                <div className="summary-level-index">第 {level.level} 级</div>
                <div className="summary-level-main">
                  <strong>{level.nodeName}</strong>
                  {level.decisionName !== level.nodeName ? (
                    <small className="muted">
                      所属：{level.decisionName}
                      {level.isReference ? ' · 引用' : ''}
                    </small>
                  ) : level.isReference ? (
                    <small className="muted">引用</small>
                  ) : null}
                </div>
                <div className="summary-level-result">
                  {level.finalResult}
                  <span className={`badge ${level.status === 'manual' ? 'manual' : 'soft'}`}>
                    {level.status === 'manual' ? '手动' : '系统'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="summary-actions">
        <button
          className="btn"
          onClick={() => {
            store.enterDecision(session.rootId)
          }}
        >
          再抽一次
        </button>
        <button className="btn primary" onClick={() => store.exitSession()}>
          返回
        </button>
      </footer>
    </div>
  )
}
