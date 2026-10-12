import Card from './shared/Card.jsx';
import SocialContentList from './SocialContentList.jsx';

const duration = seconds => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const METRICS = [
  ['views', 'Views'], ['likes', 'Likes'], ['comments', 'Comments'],
  ['watchHours', 'Watch hours'], ['shares', 'Shares'], ['averageViewDuration', 'Avg. view', duration],
];

export default function YouTubePublications({ posts = [], notes = [], status, limit = 12, compact = false }) {
  const Container = compact ? 'section' : Card;
  return <Container className={compact ? 'yt-publications' : 'card-section yt-publications'} {...(compact ? {} : { static: true })}>
    <h2 className="card-section-title">Latest publications</h2>
    <p className="list-row-meta yt-publications-description">Your {limit} newest uploads, newest first · lifetime performance. Watch metrics can take time to appear.</p>
    <SocialContentList platform="youtube" posts={posts} metricFields={METRICS}
      emptyMessage={status === 'unavailable' ? 'Publications are unavailable. Use Refresh to try again.' : 'No published videos yet. Your latest uploads will appear here.'} />
    {notes.map(note => <p className="list-row-meta" role="status" key={note}>{note}</p>)}
  </Container>;
}
