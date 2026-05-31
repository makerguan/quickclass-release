-- 为七年级（2）班创建测试数据
-- 学生：陈小明、刘小红、张伟

-- 陈小明的3个活动对话
INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_chen_1', 'student_chen', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0002lhw9hcxgm112', '方程基础', datetime('now', '-2 hours'), datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_1', 'c2_chen_1', 'user', '老师，什么是方程？我不太理解', datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_2', 'c2_chen_1', 'assistant', '方程就像一个天平，两边要一样重。比如 x + 2 = 5，意思是把一个数加上2会等于5，你能猜到x是多少吗？', datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_3', 'c2_chen_1', 'user', 'x = 3！因为3加2等于5', datetime('now', '-1 hour'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_4', 'c2_chen_1', 'assistant', '完全正确！你已经理解了方程的基本思想。方程就是含有未知数的等式，我们的目标就是找出未知数的值。', datetime('now', '-1 hour'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_5', 'c2_chen_1', 'user', '那 x - 1 = 4 怎么解？', datetime('now', '-30 mins'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_1_6', 'c2_chen_1', 'assistant', '好问题！x - 1 = 4，意味着x减去1等于4，所以x = 5。你可以用逆运算：把-1移到等号另一边变成+1，所以x = 4 + 1 = 5。', datetime('now', '-30 mins'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_chen_2', 'student_chen', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0003lhw9mwoqgn4t', '等量关系', datetime('now', '-3 hours'), datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_1', 'c2_chen_2', 'user', '老师，苹果比香蕉多3个怎么列方程？', datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_2', 'c2_chen_2', 'assistant', '好问题！设苹果有x个，香蕉有y个。苹果比香蕉多3个可以写成：x = y + 3，或者 x - y = 3。你喜欢哪种形式？', datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_3', 'c2_chen_2', 'user', '我喜欢 x = y + 3，更容易理解', datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_4', 'c2_chen_2', 'assistant', '很好的选择！这就是找到等量关系的第一步。继续思考：如果我们知道苹果有8个，能求出香蕉吗？', datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_5', 'c2_chen_2', 'user', '可以，代入得 8 = y + 3，所以 y = 5', datetime('now', '-1 hour'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_2_6', 'c2_chen_2', 'assistant', '太棒了！你已经掌握了列方程和应用方程解决问题的方法。', datetime('now', '-1 hour'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_chen_3', 'student_chen', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0005lhw9gdnwg0dm', '移项法则', datetime('now', '-4 hours'), datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_1', 'c2_chen_3', 'user', '老师，移项是怎么回事？总是搞混', datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_2', 'c2_chen_3', 'assistant', '移项其实很简单：把项从一边换到另一边时，要变号。比如 x + 3 = 5，把+3移到右边变成-3，得到 x = 5 - 3 = 2。', datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_3', 'c2_chen_3', 'user', '那 x - 5 = 2 怎么移项？', datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_4', 'c2_chen_3', 'assistant', 'x - 5 = 2，把-5移到右边变成+5，所以 x = 2 + 5 = 7。记住：加变减，减变加。', datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_5', 'c2_chen_3', 'user', '明白了！3x = 12 怎么解？', datetime('now', '-2 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_3_6', 'c2_chen_3', 'assistant', '3x = 12 是乘法方程，用逆运算除以3：x = 12 ÷ 3 = 4。移项法则只适用于加减，但乘除用逆运算！', datetime('now', '-2 hours'));

-- 刘小红的3个活动对话
INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_liu_1', 'student_liu', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0002lhw9hcxgm112', '方程入门', datetime('now', '-5 hours'), datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_1', 'c2_liu_1', 'user', '老师，我看到作业里有方程，不知道从哪里下手', datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_2', 'c2_liu_1', 'assistant', '别担心！方程其实就是让我们找出未知数的值。比如 \"? + 3 = 7\"，问号是多少？', datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_3', 'c2_liu_1', 'user', '问号是4，因为4加3等于7', datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_4', 'c2_liu_1', 'assistant', '太好了！在代数中，我们用x代表问号。所以 ? + 3 = 7 就变成了 x + 3 = 7，x = 4。', datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_5', 'c2_liu_1', 'user', '哦原来是这样！那 x + 5 = 9 呢？', datetime('now', '-3 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l1_6', 'c2_liu_1', 'assistant', 'x + 5 = 9，x = 9 - 5 = 4。记住：加法方程用减法逆运算。', datetime('now', '-3 hours'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_liu_2', 'student_liu', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0003lhw9mwoqgn4t', '等量关系练习', datetime('now', '-6 hours'), datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_1', 'c2_liu_2', 'user', '老师，\"甲数是乙数的2倍\"怎么列方程？', datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_2', 'c2_liu_2', 'assistant', '设甲数为x，乙数为y。\"甲数是乙数的2倍\"意思是 x = 2y。你能想到其他形式吗？', datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_3', 'c2_liu_2', 'user', '可以写成 x - 2y = 0 吗？', datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_4', 'c2_liu_2', 'assistant', '完全正确！两种形式都可以。第一种 x = 2y 更直观，第二种 x - 2y = 0 在计算时更方便。', datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_5', 'c2_liu_2', 'user', '如果甲数是10，乙数是多少？', datetime('now', '-4 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l2_6', 'c2_liu_2', 'assistant', '代入 x = 2y，10 = 2y，所以 y = 5。', datetime('now', '-4 hours'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_liu_3', 'student_liu', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0005lhw9gdnwg0dm', '移项练习', datetime('now', '-7 hours'), datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_1', 'c2_liu_3', 'user', '老师，2x + 3 = 11 这种方程怎么做？', datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_2', 'c2_liu_3', 'assistant', '两步方程！第一步：移项，2x = 11 - 3 = 8。第二步：系数化为1，x = 8 ÷ 2 = 4。', datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_3', 'c2_liu_3', 'user', '为什么要先移项再除？', datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_4', 'c2_liu_3', 'assistant', '因为要遵守运算顺序：先处理加减，再处理乘除。先移项去掉多余的数，再缩小系数。', datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_5', 'c2_liu_3', 'user', '那 5x - 4 = 16 呢？', datetime('now', '-5 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_l3_6', 'c2_liu_3', 'assistant', '5x - 4 = 16，第一步移项：5x = 16 + 4 = 20，第二步：x = 20 ÷ 5 = 4。', datetime('now', '-5 hours'));

-- 张伟的3个活动对话
INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_zhang_1', 'student_zhang', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0002lhw9hcxgm112', '方程概念', datetime('now', '-8 hours'), datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_1', 'c2_zhang_1', 'user', '老师，方程和等式有什么区别？', datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_2', 'c2_zhang_1', 'assistant', '好问题！等式是两边相等的式子，如 3 + 5 = 8。方程是含有未知数的等式，如 x + 5 = 8。所以方程是特殊的等式。', datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_3', 'c2_zhang_1', 'user', '那 2 + 3 = 5 是方程吗？', datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_4', 'c2_zhang_1', 'assistant', '不是，因为它没有未知数。所有方程都是等式，但只有含未知数的等式才是方程。', datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_5', 'c2_zhang_1', 'user', '明白了！那 x = 5 是方程吗？', datetime('now', '-6 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z1_6', 'c2_zhang_1', 'assistant', '是！x = 5 既是方程也是等式，而且是最简单的方程形式。', datetime('now', '-6 hours'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_zhang_2', 'student_zhang', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0003lhw9mwoqgn4t', '设未知数', datetime('now', '-9 hours'), datetime('now', '-9 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_1', 'c2_zhang_2', 'user', '老师，应用题怎么判断设谁为x？', datetime('now', '-9 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_2', 'c2_zhang_2', 'assistant', '一般设问题中要求的量为x。比如\"求甲数\"就设甲数为x，求乙数就设乙数为x。', datetime('now', '-9 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_3', 'c2_zhang_2', 'user', '如果题目说\"甲比乙多3，甲是10\"怎么求乙？', datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_4', 'c2_zhang_2', 'assistant', '设乙为x。甲比乙多3，所以甲 = x + 3。已知甲 = 10，所以 10 = x + 3，x = 7。', datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_5', 'c2_zhang_2', 'user', '我也可以设甲为x，然后解出来再算乙吗？', datetime('now', '-7 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z2_6', 'c2_zhang_2', 'assistant', '可以，但多一步。如果设甲为x，已知甲=10可以求出x的值，然后乙 = x - 3。两种方法都可以！', datetime('now', '-7 hours'));

INSERT INTO Conversation (id, userId, classId, presetConversationId, title, createdAt, updatedAt) VALUES 
('c2_zhang_3', 'student_zhang', 'cmopks3rz0001pkoasgqvtsei', 'cmopk6g5i0005lhw9gdnwg0dm', '解方程步骤', datetime('now', '-10 hours'), datetime('now', '-10 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_1', 'c2_zhang_3', 'user', '老师，解方程有固定步骤吗？', datetime('now', '-10 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_2', 'c2_zhang_3', 'assistant', '有！第一步：去括号（如果有）；第二步：移项；第三步：合并同类项；第四步：系数化为1。', datetime('now', '-10 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_3', 'c2_zhang_3', 'user', '4(x + 2) = 20 怎么做？', datetime('now', '-9 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_4', 'c2_zhang_3', 'assistant', '第一步去括号：4x + 8 = 20；第二步移项：4x = 12；第三步系数化为1：x = 3。', datetime('now', '-9 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_5', 'c2_zhang_3', 'user', '为什么要去括号？不能直接移项吗？', datetime('now', '-8 hours'));
INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES 
('mc2_z3_6', 'c2_zhang_3', 'assistant', '因为括号表示整体参与运算。不去括号直接移项会改变题意。去括号后式子才正确。', datetime('now', '-8 hours'));