import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Nutrition from '../../components/health/Nutrition.jsx';
import Supplements from '../../components/health/Supplements.jsx';
import Fitness from '../../components/health/Fitness.jsx';
import '../../styles/health.css';

export default function Health() {
  const location = useLocation();
  useEffect(() => {
    const section = location.hash.slice(1) || location.pathname.split('/')[2];
    if (['nutrition', 'supplements', 'fitness'].includes(section)) {
      requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }));
    }
  }, [location.hash, location.pathname]);
  return <div className="health-page fade-in">
    <header className="health-header"><div><span className="section-label">Daily foundations</span><h1>Health<span>.</span></h1><p>Fuel, supplement, train. Your daily picture in one place.</p></div>
      <nav className="health-jump segmented" aria-label="Health sections"><a href="#nutrition"><i className="ti ti-tools-kitchen-2" aria-hidden="true" />Nutrition</a><a href="#supplements"><i className="ti ti-pill" aria-hidden="true" />Supplements</a><a href="#fitness"><i className="ti ti-barbell" aria-hidden="true" />Fitness</a></nav>
    </header>
    <section id="nutrition" className="health-section" aria-labelledby="health-nutrition-title"><div className="health-section-head"><span className="health-section-number">01</span><div><h2 id="health-nutrition-title">Nutrition</h2><p>Your intake, your targets.</p></div><i className="ti ti-tools-kitchen-2" aria-hidden="true" /></div><Nutrition embedded /></section>
    <section id="supplements" className="health-section" aria-labelledby="health-supplements-title"><div className="health-section-head"><span className="health-section-number">02</span><div><h2 id="health-supplements-title">Supplements</h2><p>Your stack and daily checklist.</p></div><i className="ti ti-pill" aria-hidden="true" /></div><Supplements embedded /></section>
    <section id="fitness" className="health-section" aria-labelledby="health-fitness-title"><div className="health-section-head"><span className="health-section-number">03</span><div><h2 id="health-fitness-title">Fitness</h2><p>Your weekly plan, in session order.</p></div><i className="ti ti-barbell" aria-hidden="true" /></div><Fitness embedded /></section>
  </div>;
}
