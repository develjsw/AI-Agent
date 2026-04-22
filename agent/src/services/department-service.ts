import { prisma } from '../prisma.js';

export class DepartmentService {
  async listAllNames(): Promise<string[]> {
    const departments = await prisma.department.findMany();
    return departments.map((department) => department.name);
  }
}

export const departmentService = new DepartmentService();
