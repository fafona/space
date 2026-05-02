import ShuangkouScoreClient from "@/app/shuangkoujifen/ShuangkouScoreClient";

export const metadata = {
  title: "双扣计分 | 小工具 | Faolla",
  description: "个人用户后台里的双扣计分小工具。",
};

export default function PersonalShuangkouScorePage() {
  return <ShuangkouScoreClient subtitle="个人后台 / 小工具" />;
}
