import { number } from '../lib/helpers.js';

const fields = {
  youtube: [['views', 'Views'], ['watchHours', 'Watch hours'], ['likes', 'Likes'], ['comments', 'Comments']],
  instagram: [['views', 'Views'], ['reach', 'Reach'], ['likes', 'Likes'], ['comments', 'Comments']],
  x: [['impressions', 'Impressions'], ['likes', 'Likes'], ['reposts', 'Reposts'], ['replies', 'Replies'], ['urlClicks', 'Link clicks']],
};
export default function SocialContentList({ platform, posts = [], metricFields = fields[platform], emptyMessage = 'No content returned for this account.' }) {
  if (!posts.length) return <p className="list-row-meta">{emptyMessage}</p>;
  return <div className="social-content-list">{posts.map(post => <a className="social-content-item" key={post.id}
    href={post.permalink} target="_blank" rel="noopener noreferrer">
    {post.thumbnail && <img src={post.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <div className="social-content-text"><div className="social-content-title">{post.caption || post.type || 'Post'}</div>
      <div className="list-row-meta">{post.timestamp ? new Date(post.timestamp).toLocaleDateString() : post.type}</div>
      <div className="social-content-metrics">{metricFields.map(([key, label, format = number]) => <span key={key}>{label} <strong>{post[key] == null ? '—' : format(post[key])}</strong></span>)}</div>
    </div><i className="ti ti-external-link" aria-hidden="true" />
  </a>)}</div>;
}
