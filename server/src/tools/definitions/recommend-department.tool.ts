import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

export const createRecommendDepartmentTool = (prisma: PrismaService) =>
  tool(
    async ({ symptom }) => {
      const departments = await prisma.department.findMany();

      return JSON.stringify({
        symptom,
        availableDepartments: departments.map((d) => d.name),
        instruction:
          '위 증상을 바탕으로 적합한 진료과를 추천해주세요. 예: 두통→신경과, 복통→내과, 골절→정형외과',
      });
    },
    {
      name: 'recommend_department',
      description:
        '증상을 입력하면 적합한 진료과를 추천합니다. AI가 증상과 진료과 목록을 바탕으로 판단합니다.',
      schema: z.object({
        symptom: z.string().describe('환자 증상 (예: 두통이 심해요, 무릎이 아파요)'),
      }),
    },
  );
