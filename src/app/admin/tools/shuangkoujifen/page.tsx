import ShuangkouScoreClient from "@/app/shuangkoujifen/ShuangkouScoreClient";

export const metadata = {
  title: "双扣计分 | 小工具 | Faolla",
  description: "商家用户后台里的双扣计分小工具。",
};

export default function MerchantShuangkouScorePage() {
  return <ShuangkouScoreClient subtitle="商家后台 / 小工具" />;
}
