import { investigations, type Investigation } from '../lib/investigations'
import Icon from './Icon'

export default function InvestigationStarter({ onStart }: { onStart: (investigation: Investigation) => void }) {
  return <section className="investigation-starter" aria-labelledby="investigations-heading">
    <div className="starter-heading"><h2 id="investigations-heading">Questions to try</h2></div>
    <div className="investigation-options">{investigations.map((investigation, index) => <button className="investigation-button" key={investigation.id} onClick={() => onStart(investigation)}>
      <span className="investigation-number">0{index + 1}</span><span><strong>{investigation.title}</strong><small>{investigation.question}</small></span><Icon name="arrow" />
    </button>)}</div>
  </section>
}
