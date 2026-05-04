import NoMercyFlagGameClient from "./NoMercyFlagGameClient";

export const metadata = {
  title: "不服再试 | 游戏大厅 | Faolla",
  description: "用各国国旗做叠层三消闯关的休闲小游戏。",
};

export default function BuFuZaiPage() {
  return <NoMercyFlagGameClient subtitle="游戏大厅" lobbyHref="/game-lobby" />;
}
