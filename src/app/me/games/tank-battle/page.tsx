import TankBattleClient from "@/app/tank-battle/TankBattleClient";

export const metadata = {
  title: "坦克大战 | 小游戏 | Faolla",
  description: "个人用户后台里的经典坦克防守小游戏。",
};

export default function PersonalTankBattlePage() {
  return <TankBattleClient subtitle="个人后台 / 小游戏" />;
}
