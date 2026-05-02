import ShuangkouScoreClient from "./ShuangkouScoreClient";

export const metadata = {
  title: "双扣计分工具 | Faolla",
  description: "根据双扣常见双扣、单扣、平扣和炸弹翻倍规则快速计算每局与累计得分。",
  alternates: {
    canonical: "https://www.faolla.com/shuangkoujifen",
  },
};

export default function ShuangkouScorePage() {
  return <ShuangkouScoreClient />;
}
