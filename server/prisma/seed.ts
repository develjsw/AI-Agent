import 'dotenv/config';
import { PrismaClient, AppointmentStatus } from '../../prisma/generated/index.js';

const prisma = new PrismaClient();

const departments = [
  { name: '내과' },
  { name: '외과' },
  { name: '신경과' },
  { name: '정형외과' },
  { name: '피부과' },
  { name: '산부인과' },
  { name: '소아과' },
  { name: '이비인후과' },
  { name: '안과' },
  { name: '정신건강의학과' },
];

const hospitals = [
  {
    name: '서울중앙병원',
    address: '서울특별시 중구 을지로 245',
    latitude: 37.5665,
    longitude: 126.9939,
    phone: '02-1234-5678',
    weekdayHours: '09:00-18:00',
    weekendHours: '09:00-13:00',
    departments: ['내과', '외과', '신경과', '정형외과', '산부인과', '소아과'],
    doctors: [
      { name: '김민준', department: '내과' },
      { name: '이서연', department: '내과' },
      { name: '박지훈', department: '외과' },
      { name: '최수아', department: '신경과' },
      { name: '정우성', department: '정형외과' },
      { name: '한지민', department: '산부인과' },
      { name: '오세훈', department: '소아과' },
    ],
  },
  {
    name: '강남메디컬센터',
    address: '서울특별시 강남구 테헤란로 152',
    latitude: 37.5001,
    longitude: 127.0363,
    phone: '02-2345-6789',
    weekdayHours: '08:30-17:30',
    weekendHours: null,
    departments: ['내과', '피부과', '안과', '이비인후과', '정신건강의학과'],
    doctors: [
      { name: '윤도현', department: '내과' },
      { name: '임수정', department: '피부과' },
      { name: '강기영', department: '안과' },
      { name: '신동엽', department: '이비인후과' },
      { name: '유재석', department: '정신건강의학과' },
    ],
  },
  {
    name: '마포한강의원',
    address: '서울특별시 마포구 양화로 45',
    latitude: 37.5547,
    longitude: 126.9192,
    phone: '02-3456-7890',
    weekdayHours: '09:00-19:00',
    weekendHours: '10:00-14:00',
    departments: ['내과', '소아과', '이비인후과'],
    doctors: [
      { name: '송혜교', department: '내과' },
      { name: '차인표', department: '소아과' },
      { name: '김혜수', department: '이비인후과' },
    ],
  },
  {
    name: '강북정형외과의원',
    address: '서울특별시 강북구 도봉로 83',
    latitude: 37.6396,
    longitude: 127.0253,
    phone: '02-4567-8901',
    weekdayHours: '09:00-18:00',
    weekendHours: '09:00-13:00',
    departments: ['정형외과', '외과'],
    doctors: [
      { name: '황정민', department: '정형외과' },
      { name: '설경구', department: '정형외과' },
      { name: '최민식', department: '외과' },
    ],
  },
  {
    name: '종로24시응급병원',
    address: '서울특별시 종로구 종로 50',
    latitude: 37.5720,
    longitude: 126.9794,
    phone: '02-5678-9012',
    weekdayHours: '24시간',
    weekendHours: '24시간',
    departments: ['내과', '외과', '신경과', '정형외과'],
    doctors: [
      { name: '이병헌', department: '내과' },
      { name: '원빈', department: '외과' },
      { name: '정우', department: '신경과' },
      { name: '소지섭', department: '정형외과' },
    ],
  },
];

const users = [
  { name: '홍길동', phone: '010-1111-2222', birthDate: new Date('1990-05-15') },
  { name: '김영희', phone: '010-3333-4444', birthDate: new Date('1985-11-20') },
  { name: '박철수', phone: '010-5555-6666', birthDate: new Date('1978-03-08') },
];

async function main() {
  console.log('Seeding...');

  await prisma.appointment.deleteMany();
  await prisma.waitingStatus.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.hospitalDepartment.deleteMany();
  await prisma.hospital.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();

  const createdDepts = await Promise.all(
    departments.map((dept) =>
      prisma.department.create({ data: dept }),
    ),
  );
  const deptByName = Object.fromEntries(createdDepts.map((d) => [d.name, d]));
  console.log(`✓ departments: ${createdDepts.length}개`);

  for (const hospital of hospitals) {
    const { departments: deptNames, doctors: doctorList, ...hospitalData } = hospital;

    const createdHospital = await prisma.hospital.create({ data: hospitalData });

    await prisma.hospitalDepartment.createMany({
      data: deptNames.map((name) => ({
        hospitalId: createdHospital.id,
        departmentId: deptByName[name].id,
      })),
    });

    await prisma.doctor.createMany({
      data: doctorList.map((doctor) => ({
        name: doctor.name,
        hospitalId: createdHospital.id,
        departmentId: deptByName[doctor.department].id,
      })),
    });

    const waitingDepts = deptNames.slice(0, 2);
    await prisma.waitingStatus.createMany({
      data: waitingDepts.map((name) => ({
        hospitalId: createdHospital.id,
        departmentId: deptByName[name].id,
        waitingCount: Math.floor(Math.random() * 10),
        estimatedMinutes: Math.floor(Math.random() * 40) + 5,
      })),
    });
  }
  console.log(`✓ hospitals: ${hospitals.length}개`);

  const createdUsers = await Promise.all(
    users.map((user) => prisma.user.create({ data: user })),
  );
  console.log(`✓ users: ${createdUsers.length}개`);

  const firstDoctor = await prisma.doctor.findFirst();
  if (firstDoctor) {
    await prisma.appointment.createMany({
      data: [
        {
          userId: createdUsers[0].id,
          doctorId: firstDoctor.id,
          scheduledAt: new Date('2026-04-25 10:00:00'),
          status: AppointmentStatus.CONFIRMED,
          note: '두통과 어지러움 증상',
        },
        {
          userId: createdUsers[1].id,
          doctorId: firstDoctor.id,
          scheduledAt: new Date('2026-04-25 11:00:00'),
          status: AppointmentStatus.PENDING,
          note: '정기 검진',
        },
      ],
    });
  }
  console.log(`✓ appointments: 2개`);

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
