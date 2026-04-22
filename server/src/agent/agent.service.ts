import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { ToolRegistryService } from '../tools/tool-registry.service';

const SYSTEM_PROMPT = `
당신은 병원 예약 및 의료 정보를 도와주는 AI 어시스턴트입니다.

역할:
- 사용자의 증상을 듣고 적합한 진료과를 추천합니다.
- 위치 또는 진료과 기준으로 병원을 검색합니다.
- 병원 상세 정보(운영시간, 전화번호, 진료과)를 제공합니다.
- 진료 예약 생성, 조회, 취소를 처리합니다.
- 병원 대기 현황을 안내합니다.

규칙:
- 항상 한국어로 친절하게 답변합니다.
- 예약 생성 전 반드시 날짜/시간/의사 정보를 확인합니다.
- 불확실한 정보는 추측하지 않고 도구를 사용해 조회합니다.
- 위 내용과 관련 없는 질문에는 답변이 어렵다고 안내합니다.
`.trim();

@Injectable()
export class AgentService {
  private readonly model;
  private readonly sessionHistories = new Map<string, Content[]>();

  constructor(private readonly toolRegistryService: ToolRegistryService) {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [
        {
          functionDeclarations: this.toolRegistryService.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
    });
  }

  async processMessage(sessionId: string, userMessage: string): Promise<string> {
    const history = this.getOrCreateHistory(sessionId);
    const chat = this.model.startChat({ history });

    let result = await chat.sendMessage(userMessage);

    while (result.response.functionCalls()?.length) {
      const calls = result.response.functionCalls()!;

      const toolResponses = await Promise.all(
        calls.map(async (call) => {
          const tool = this.toolRegistryService.getTool(call.name);
          const output = await tool.execute(call.args as Record<string, unknown>);
          return { name: call.name, response: { output } };
        }),
      );

      result = await chat.sendMessage(
        toolResponses.map((r) => ({ functionResponse: r })),
      );
    }

    const responseText = result.response.text();

    history.push({ role: 'user', parts: [{ text: userMessage }] });
    history.push({ role: 'model', parts: [{ text: responseText }] });
    this.sessionHistories.set(sessionId, history);

    return responseText;
  }

  clearHistory(sessionId: string): void {
    this.sessionHistories.delete(sessionId);
  }

  private getOrCreateHistory(sessionId: string): Content[] {
    if (!this.sessionHistories.has(sessionId)) {
      this.sessionHistories.set(sessionId, []);
    }
    return this.sessionHistories.get(sessionId)!;
  }
}
