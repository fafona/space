import TankBattleClient from "@/app/tank-battle/TankBattleClient";

export const metadata = {
  title: "坦克大战 | 游戏大厅 | Faolla",
  description: "商家用户后台里的经典坦克防守游戏。",
};

export default function MerchantTankBattlePage() {
  return <TankBattleClient subtitle="商家后台 / 游戏大厅" lobbyHref="/admin?mobileTab=self&selfSection=games" />;
}
