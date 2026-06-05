// variant: 'cards' | 'strip' | 'tiles'
export default function HomeSkeleton({ variant = 'cards', count = 6 }) {
  const cls = {
    cards: 'HGrid',
    strip: 'ContinueStrip__Grid',
    tiles: 'StatTiles',
  }[variant];
  const item = {
    cards: 'HCard HCard--skeleton',
    strip: 'HRecentCard HRecentCard--skeleton',
    tiles: 'StatTile StatTile--skeleton',
  }[variant];
  return (
    <div className={cls}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`HSkel ${item}`} />
      ))}
    </div>
  );
}
