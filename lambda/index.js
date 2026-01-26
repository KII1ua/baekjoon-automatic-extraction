require("dotenv").config();

const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");
const pool = require('./classification.json');

const BAEKJOON_URL      = "https://www.acmicpc.net/problem";
const SOLVED_AC_API_URL = "https://solved.ac/api/v3/search/problem";

const AWS_REGION     = "ap-northeast-2";
const TABLE_NAME     = "SolvedProblems";
const LOCAL_ENDPOINT = "http://localhost:8000";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 스터디 멤버
const STUDY_MEMBERS = { 
  "KII1ua": "skfnx13",
  "Eunjin3395": "jennyeunjin"
};

const LEVELS = [
  "UR", "B5", "B4", "B3", "B2", "B1", 
  "S5", "S4", "S3", "S2", "S1", 
  "G5", "G4", "G3", "G2", "G1", 
  "P5", "P4", "P3", "P2", "P1"
];

const IS_LOCAL = !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.AWS_ACCESS_KEY_ID;

const dbClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  endpoint: IS_LOCAL ? LOCAL_ENDPOINT : undefined,
  credentials: IS_LOCAL 
    ? { accessKeyId: "local", secretAccessKey: "local" } 
    : undefined
});


const tierToNumber = (tierStr) => {
  const index = LEVELS.indexOf(tierStr.toUpperCase());
  return index === -1 ? 0 : index;
};

// 시간 변환
const getKSTTime = () => {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffset);
  return kstDate.toISOString().replace('T', ' ').substring(0, 19);
};

// 배열 무작위 셔플
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// 디스코드 메시지 보내기
async function sendDiscordMessage(problems) {
  if (!DISCORD_WEBHOOK_URL) return;

  const fullTime = getKSTTime();
  const dateOnly = fullTime.split(' ')[0];

  let messageContent = `📅 **${dateOnly} 코딩테스트**\n`;

  problems.forEach((p, idx) => {
    messageContent += `${idx + 1}. [**[${p.id}] ${p.title}**](${BAEKJOON_URL}/${p.id})\n`;
  });

  const payload = {
    username: "Daily Baekjoon",
    content: messageContent
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("✅ 디스코드 메시지 전송 완료!");
  } catch (err) {
    console.error("❌ 디스코드 전송 에러:", err.message);
  }
}

// 문제 추출 로직
async function handler(event) {
  console.log("🚀 문제 추출 프로세스 시작...");
  
  const selectedProblems = [];
  const usedProblemIds = new Set();

  try {
    let attempts = 0;
    // 5문제가 채워질 때까지 반복
    while (selectedProblems.length < 5 && attempts < 15) {
      attempts++;
      
      const target = pool.selectedPool[Math.floor(Math.random() * pool.selectedPool.length)];
      const groupType = Math.random() > 0.5 ? "high" : "low";
      const minLevel = tierToNumber(target.level[groupType].min);
      const maxLevel = tierToNumber(target.level[groupType].max);

      const solverFilter = Object.values(STUDY_MEMBERS).map(id => `!s@${id}`).join(" ");
      const rawQuery = `tag:${target.tag} tier:${minLevel}..${maxLevel} s#${target.minParticipants}.. ${solverFilter}`;
      const apiUrl = `${SOLVED_AC_API_URL}?query=${encodeURIComponent(rawQuery)}&sort=random`;

      const response = await fetch(apiUrl, { headers: { 'User-Agent': 'node-fetch' } });
      const data = await response.json();

      if (!data.items || data.items.length === 0) continue;

      for (const problem of data.items) {
        if (selectedProblems.length >= 5) break;

        const pId = String(problem.problemId);
        if (usedProblemIds.has(pId)) continue;

        // DB 중복 체크 (sync.js가 채워넣은 데이터와 대조)
        const { Item } = await dbClient.send(new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ problemId: pId })
        }));

        if (!Item) {
          selectedProblems.push({
            id: pId,
            title: problem.titleKo,
            tier: LEVELS[problem.level],
            tag: target.tag.toUpperCase()
          });
          usedProblemIds.add(pId);
        }
      }
    }

    if (selectedProblems.length > 0) {
      const finalProblems = shuffleArray(selectedProblems);
      
      // 콘솔 출력
      console.log(`✅ ${finalProblems.length}개 추출 성공. 디스코드로 전송합니다.`);
      
      // 디스코드 전송 함수 호출
      await sendDiscordMessage(finalProblems);
    } else {
      console.log("⚠️ 문제를 찾지 못했습니다. 태그나 난이도 설정을 확인하세요.");
    }

  } catch (error) {
    console.error("❌ 실행 중 에러:", error.message);
  }
}

// 로컬 실행부
if (require.main === module) {
  handler({}).catch(err => console.error(err));
}