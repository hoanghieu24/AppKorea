const sequelize = require('../config/db');

const User = require('./User');
const Class = require('./Class');
const ClassMember = require('./ClassMember');
const Lesson = require('./Lesson');
const Word = require('./Word');
const Grammar = require('./Grammar');
const UserWordProgress = require('./UserWordProgress');
const UserStats = require('./UserStats');
const Assignment = require('./Assignment');
const AssignmentTarget = require('./AssignmentTarget');
const Submission = require('./Submission');
const DictionarySavedWord = require('./DictionarySavedWord');
const Notebook = require('./Notebook');
const ExamHistory = require('./ExamHistory');
const PdfUpload = require('./PdfUpload');

/* ============ QUAN HỆ (ASSOCIATIONS) ============ */

// User 1-1 UserStats
User.hasOne(UserStats, { foreignKey: 'userId', onDelete: 'CASCADE' });
UserStats.belongsTo(User, { foreignKey: 'userId' });

// Class (giáo viên tạo, có nhiều học sinh qua ClassMember)
User.hasMany(Class, { foreignKey: 'teacherId', as: 'ownedClasses' });
Class.belongsTo(User, { foreignKey: 'teacherId', as: 'teacher' });

Class.hasMany(ClassMember, { foreignKey: 'classId', as: 'members', onDelete: 'CASCADE' });
ClassMember.belongsTo(Class, { foreignKey: 'classId' });

User.hasMany(ClassMember, { foreignKey: 'studentId', as: 'classMemberships' });
ClassMember.belongsTo(User, { foreignKey: 'studentId', as: 'student' });

// Many-to-many tiện lợi: Class <-> Student (User) qua ClassMember
Class.belongsToMany(User, { through: ClassMember, foreignKey: 'classId', otherKey: 'studentId', as: 'students' });
User.belongsToMany(Class, { through: ClassMember, foreignKey: 'studentId', otherKey: 'classId', as: 'classes' });

// Lesson
User.hasMany(Lesson, { foreignKey: 'ownerId', as: 'lessons' });
Lesson.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
Class.hasMany(Lesson, { foreignKey: 'classId' });
Lesson.belongsTo(Class, { foreignKey: 'classId' });

// Word thuộc Lesson (tuỳ chọn) + thuộc owner (tuỳ chọn)
Lesson.hasMany(Word, { foreignKey: 'lessonId', as: 'words' });
Word.belongsTo(Lesson, { foreignKey: 'lessonId', as: 'lesson' });
User.hasMany(Word, { foreignKey: 'ownerId' });
Word.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// Grammar thuộc Lesson
Lesson.hasMany(Grammar, { foreignKey: 'lessonId', as: 'grammarPoints' });
Grammar.belongsTo(Lesson, { foreignKey: 'lessonId', as: 'lesson' });
User.hasMany(Grammar, { foreignKey: 'ownerId' });
Grammar.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// UserWordProgress (User <-> Word many-to-many với dữ liệu phụ)
User.hasMany(UserWordProgress, { foreignKey: 'userId' });
UserWordProgress.belongsTo(User, { foreignKey: 'userId' });
Word.hasMany(UserWordProgress, { foreignKey: 'wordId' });
UserWordProgress.belongsTo(Word, { foreignKey: 'wordId' });

// Assignment (giáo viên giao, có thể gắn với 1 lớp)
User.hasMany(Assignment, { foreignKey: 'teacherId', as: 'createdAssignments' });
Assignment.belongsTo(User, { foreignKey: 'teacherId', as: 'teacher' });
Class.hasMany(Assignment, { foreignKey: 'classId' });
Assignment.belongsTo(Class, { foreignKey: 'classId' });
Lesson.hasMany(Assignment, { foreignKey: 'lessonId' });
Assignment.belongsTo(Lesson, { foreignKey: 'lessonId' });

// AssignmentTarget (assignment <-> student)
Assignment.hasMany(AssignmentTarget, { foreignKey: 'assignmentId', as: 'targets', onDelete: 'CASCADE' });
AssignmentTarget.belongsTo(Assignment, { foreignKey: 'assignmentId' });
User.hasMany(AssignmentTarget, { foreignKey: 'studentId' });
AssignmentTarget.belongsTo(User, { foreignKey: 'studentId', as: 'student' });

Assignment.belongsToMany(User, { through: AssignmentTarget, foreignKey: 'assignmentId', otherKey: 'studentId', as: 'assignedStudents' });
User.belongsToMany(Assignment, { through: AssignmentTarget, foreignKey: 'studentId', otherKey: 'assignmentId', as: 'assignedHomework' });

// Submission (1 học sinh nộp 1 bài cho 1 assignment)
Assignment.hasMany(Submission, { foreignKey: 'assignmentId', as: 'submissions', onDelete: 'CASCADE' });
Submission.belongsTo(Assignment, { foreignKey: 'assignmentId' });
User.hasMany(Submission, { foreignKey: 'studentId' });
Submission.belongsTo(User, { foreignKey: 'studentId', as: 'student' });

// Dictionary / Notebook / ExamHistory / PdfUpload — thuộc về 1 user
User.hasMany(DictionarySavedWord, { foreignKey: 'userId' });
DictionarySavedWord.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Notebook, { foreignKey: 'userId' });
Notebook.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(ExamHistory, { foreignKey: 'userId' });
ExamHistory.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(PdfUpload, { foreignKey: 'userId' });
PdfUpload.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Class,
  ClassMember,
  Lesson,
  Word,
  Grammar,
  UserWordProgress,
  UserStats,
  Assignment,
  AssignmentTarget,
  Submission,
  DictionarySavedWord,
  Notebook,
  ExamHistory,
  PdfUpload,
};
