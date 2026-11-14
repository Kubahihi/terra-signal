import { dailyExamples, exampleAnalysis, findingLocation, type DailyExample } from '../lib/dailyExamples'
import { formatRate } from '../lib/evidence'
import Icon from './Icon'

export default function DailyExampleStarter({ onStart }: { onStart: (example: DailyExample) => void }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadError, setDownloadError] = useState('')

  async function downloadReference() {
    setDownloading(true)
    setDownloadMessage('')
    setDownloadError('')
    try {
      const response = await fetch(exampleAnalysis.sourceHref, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`The reference analysis could not be loaded (${response.status}).`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'daily-example-analysis-1981-2025.json'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloadMessage('Reference analysis downloaded with all ten points and NASA source details.')
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'The reference analysis could not be downloaded.')
    } finally { setDownloading(false) }
  }
  return <section className="daily-example-starter" id="daily-examples" aria-labelledby="daily-examples-heading">
    <div className="daily-examples-heading"><div><p className="overline">One-click examples · {exampleAnalysis.start}–{exampleAnalysis.end}</p><h2 id="daily-examples-heading">Changes worth a closer look.</h2><p>Open a saved finding. Both places, the metric, the period and the highlighted year are set for you.</p></div><a className="text-button" href="#analysis-settings">Explore your own points <Icon name="pin" /></a></div>
    <div className="daily-example-options">{dailyExamples.map(example => <button type="button" className={`daily-example-button${example.featured ? ' featured' : ''}`} key={example.id} onClick={() => onStart(example)}>
      <span className="daily-example-type">{example.featured ? 'Featured comparison · hot days' : example.metric === 'frost_days' ? 'Daily Tmin < 0 °C' : 'Daily Tmin > 20 °C · night proxy'}</span>
      <strong className="daily-example-title">{example.title}</strong><span className="daily-example-description">{example.description}</span>
      <span className="daily-example-findings">{example.findings.map(finding => <span key={`${finding.locationId}-${finding.metric}`}><span>{findingLocation(finding).name.split(',')[0]}</span><strong>{formatRate(finding.slopePerDecade)}</strong><small>days / decade</small></span>)}</span>
      <span className="daily-example-action">Open comparison <Icon name="arrow" /></span>
    </button>)}</div>
    <details className="daily-example-notes"><summary>About these saved findings <Icon name="chevron" /></summary><div><p>These reference rates come from a NASA POWER analysis saved on {exampleAnalysis.date}, using complete annual indices for {exampleAnalysis.start}–{exampleAnalysis.end}. All displayed findings passed Holm correction across {exampleAnalysis.familySize} tests: four indices at {exampleAnalysis.candidateCount} prespecified example points. The selection is exploratory.</p><p>Opening an example loads its daily records and recalculates the charts. Chart badges apply Holm correction separately across four indices per point; they do not test whether the two places have different slopes. Data revisions can change the recalculated rates. Warm nights use daily minimum temperature as a proxy; the results describe surrounding model grid cells.</p><p><button type="button" className="text-button" disabled={downloading} onClick={downloadReference}>{downloading ? 'Downloading reference analysis…' : 'Download the reference analysis & NASA sources'} <Icon name="download" /></button></p>{downloadError && <p role="alert">{downloadError}</p>}<p role="status">{downloadMessage}</p></div></details>
  </section>
}
import { useState } from 'react'
