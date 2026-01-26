const { DynamoDBClient, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");

const dbClient = new DynamoDBClient({
    region: "ap-northeast-2",
    endpoint: "http://localhost:8000",
    credentials: { accessKeyId: "local", secretAccessKey: "local" }
});

const STUDY_MEMBERS = { 
    "KII1ua": "skfnx13",
    "Eunjin3395" : "jennyeunjin"
 };

async function syncUser(bojId) {
    let page = 1;
    let totalSynced = 0;

    console.log(`\n🚀 [${bojId}] 문제 동기화 시작!`);

    while (true) {
        // 💡 핵심: s@아이디 쿼리가 가장 정확합니다.
        const query = encodeURIComponent(`s@${bojId}`);
        const url = `https://solved.ac/api/v3/search/problem?query=${query}&page=${page}`;
        
        const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });

        if (!res.ok) {
            console.log(`   ❌ 호출 실패: ${res.status}`);
            break;
        }

        const data = await res.json();
        
        // 첫 페이지에서 총 문제 수 출력
        if (page === 1) {
            console.log(`📊 Solved.ac에서 검색된 총 문제 수: ${data.count}개`);
        }

        if (!data.items || data.items.length === 0) {
            console.log(`   🏁 모든 데이터 동기화 완료!`);
            break;
        }

        const writeRequests = data.items.map(item => ({
            PutRequest: {
                Item: marshall({
                    problemId: String(item.problemId),
                    title: item.titleKo,
                    status: "SOLVED_BY_MEMBER",
                    owner: bojId,
                    syncedAt: new Date().toISOString()
                })
            }
        }));

        try {
            for (let i = 0; i < writeRequests.length; i += 25) {
                await dbClient.send(new BatchWriteItemCommand({
                    RequestItems: { "SolvedProblems": writeRequests.slice(i, i + 25) }
                }));
            }
            totalSynced += data.items.length;
            console.log(`   ✅ ${totalSynced}개 돌파...`);
        } catch (err) {
            console.error("   ❌ DB 저장 실패:", err.message);
            break;
        }

        page++;
        await new Promise(r => setTimeout(r, 300));
    }
}

async function run() {
    for (const id of Object.values(STUDY_MEMBERS)) {
        await syncUser(id);
    }
}

run();