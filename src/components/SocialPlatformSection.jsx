import SocialAccountCard from './SocialAccountCard.jsx';
import { PLATFORMS } from '../lib/socialPlatforms.js';

export default function SocialPlatformSection({ platform, ready, accounts, busy, onConnect, onOpen, onRename, onDisconnect }) {
  const { name } = PLATFORMS[platform];
  return (
    <section className="social-section" aria-label={name}>
      <h3 className="section-label social-section-head">{name}</h3>
      <div className="grid grid-3">
        {accounts.map(account => <SocialAccountCard key={account.id} platform={platform} account={account} busy={busy}
          onOpen={() => onOpen(account)} onRename={() => onRename(account)} onDisconnect={() => onDisconnect(account)}
          onReconnect={onConnect} canConnect={ready} />)}
      </div>
    </section>
  );
}
