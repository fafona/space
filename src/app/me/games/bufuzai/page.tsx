import NoMercyFlagGameClient from "@/app/bufuzai/NoMercyFlagGameClient";

export const metadata = {
  title: "不服再试 | 个人后台 | Faolla",
  description: "个人后台游戏大厅里的国旗叠层三消小游戏。",
};

export default function PersonalBuFuZaiPage() {
  return <NoMercyFlagGameClient subtitle="个人后台 / 游戏大厅" lobbyHref="/me?mobileTab=self&selfSection=games" />;
}
