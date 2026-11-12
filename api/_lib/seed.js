// 저장소가 비어 있을 때 처음 한 번 넣는 기본 설정 (이후에는 화면에서 추가·수정)
export const SEED = {
  products: [
    { id: "remoteview", name: "리모트뷰", propertyId: "307717617" },
    { id: "remotemeeting", name: "리모트미팅", propertyId: "543595202" },
    { id: "airepoto", name: "AI레포토", propertyId: "477959686" },
    { id: "remotecall", name: "리모트콜", propertyId: "270301647", loginLabel: "gnb_cta_webviewer" },
    { id: "remotevs", name: "RemoteVS", propertyId: "368872087" },
  ],
  pages: [
    { id: "rv-main", product: "remoteview", name: "메인", urls: ["https://content.rview.com/ko/"], match: "exact", releases: [{ date: "2026-06-04" }] },
    { id: "rm-main", product: "remotemeeting", name: "메인", urls: ["https://www.remotemeeting.com/ko/"], match: "exact", releases: [{ date: "2026-06-30" }] },
    { id: "rm-features", product: "remotemeeting", name: "특장점", urls: ["https://www.remotemeeting.com/ko/features/"], match: "exact", releases: [{ date: "2026-06-30" }] },
    { id: "ai-sdk", product: "airepoto", name: "SDK 페이지", urls: ["https://www.airepoto.com/ko/sdk/"], match: "exact", releases: [{ date: "2026-09-21" }] },
  ],
};
