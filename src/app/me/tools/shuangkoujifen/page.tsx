import ShuangkouScoreClient from "@/app/shuangkoujifen/ShuangkouScoreClient";

export const metadata = {
  title: "双扣计分 | 小工具 | Faolla",
  description: "个人用户后台里的双扣计分小工具。",
};

export default function PersonalShuangkouScorePage() {
  return <ShuangkouScoreClient backHref="/me" backLabel="返回个人后台" subtitle="个人后台 / 小工具" />;
}
