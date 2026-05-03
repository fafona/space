import TankBattleClient from "@/app/tank-battle/TankBattleClient";

export const metadata = {
  title: "坦克大战 | 游戏大厅 | Faolla",
  description: "个人用户后台里的经典坦克防守游戏。",
};

export default function PersonalTankBattlePage() {
  return <TankBattleClient subtitle="个人后台 / 游戏大厅" lobbyHref="/me?mobileTab=self&selfSection=games" />;
}
