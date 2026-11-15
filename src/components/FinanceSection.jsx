// One numbered block of the combined Finance page; the id is the anchor used by the jump nav and old deep links.
export default function FinanceSection({ id, number, title, subtitle, icon, children }) {
  return <section id={id} className="fin-block" aria-labelledby={`fin-${id}-title`}>
    <div className="fin-block-head"><span className="fin-block-number">{number}</span><div><h2 id={`fin-${id}-title`}>{title}</h2><p>{subtitle}</p></div><i className={`ti ${icon}`} aria-hidden="true" /></div>
    {children}
  </section>;
}
