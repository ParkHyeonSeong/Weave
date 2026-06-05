// greeting(문자열/노드), summary(노드: "오늘 마감 5개 ..."), actions(노드 슬롯: 버튼들)
export default function HomeHero({ greeting, summary, actions }) {
  return (
    <div className="HomeHero">
      <div className="HomeHero__Text">
        <div className="HomeHero__Greeting">{greeting}</div>
        {summary && <div className="HomeHero__Summary">{summary}</div>}
      </div>
      {actions && <div className="HomeHero__Actions">{actions}</div>}
    </div>
  );
}
