# reflect module: BBS接单
# check()内预检BBS，无新帖返回None不唤醒agent
import json, time, os
from urllib import request

INTERVAL = 60
ONCE = False
# you may make agent_team_setting.json first time
_dir = os.path.dirname(os.path.abspath(__file__))
def init(a):
    global base_url, board_key, name, project_dir
    try: c = json.load(open(os.path.join(_dir, 'agent_team_setting.json')))
    except Exception: c = {}
    c.update(a)
    base_url, board_key, name = c.get('base_url', ''), c.get('board_key', ''), c.get('name', '')
    project_dir = c.get('project_dir', '')

_last_id = -1
failed = 0

def check():
    global _last_id, failed
    if not base_url: return '/exit'
    try:
        # Long-poll: blocks until new post or 55s timeout
        url = f”{base_url}/wait?since_id={_last_id}&timeout=55”
        req = request.Request(url)
        req.add_header('X-API-Key', board_key)
        posts = json.loads(request.urlopen(req, timeout=60).read())
        failed = 0
    except Exception:
        failed += 1
        return None if failed < 10 else '/exit'
    if not posts:
        return None  # timeout, no new posts
    max_id = max(p['id'] for p in posts)
    if max_id <= _last_id: return None
    # Only wake agent if there's a post relevant to this worker:
    # - Contains [指派: OurName] (task assignment)
    # - Contains [驳回重做: OurName] (rejection)
    # - Contains [指令: OurName] (direct instruction from user)
    # - Is a reply/discussion mentioning our name
    # - Or any new post after we've already started working (_last_id > 0 means we've seen tasks before)
    new_posts = [p for p in posts if p['id'] > _last_id]
    _last_id = max_id
    if not new_posts: return None

    # If we've already been working (last_id was set from a previous wake), always wake on new posts
    # But on first wake, only trigger if there's something for us
    has_relevant = any(
        f'[指派: {name}]' in p.get('content', '') or
        f'[指派：{name}]' in p.get('content', '') or
        f'[驳回重做: {name}]' in p.get('content', '') or
        f'[驳回重做：{name}]' in p.get('content', '') or
        f'[指令: {name}]' in p.get('content', '') or
        name in p.get('content', '')
        for p in new_posts
    )
    # Skip if only Coordinator's framework/setup post with no assignments
    if not has_relevant:
        all_coord_setup = all(
            p.get('author') == 'Coordinator' and '[指派' not in p.get('content', '')
            for p in new_posts
        )
        if all_coord_setup:
            return None

    return _prompt()

def _prompt():
    dir_constraint = “”
    if project_dir:
        dir_constraint = f”””
⚠️ 重要工作目录约束：
- 你的工作目录是: {project_dir}
- 所有文件读写、代码分析必须限制在此目录下
- 禁止访问此目录以外的任何文件或项目
- 如果任务涉及的文件不在此目录下，报告错误而非尝试访问
“””
    return f”””[任务协作]📋 你是一个agent worker，在BBS上接任务并执行。
BBS: {base_url} (key: {board_key})
不熟悉可看/readme?key=xxx 获取BBS用法，初次要注册起个不冲突的名字{name}并记忆名字和key
{dir_constraint}
⛔ Git 规则（严格遵守）：
- 禁止执行 git push，你没有 push 权限
- 只允许在自己的分支上 commit（分支名: hive/{name}）
- 开始工作前先 git checkout -b hive/{name}（如果分支已存在则 checkout）
- 完成后只 commit，不 push，在 BBS 汇报即可
- Coordinator 会统一审核并 push

1. GET /posts?limit=10&key=xxx 查看新帖，有必要才看更多
2. 找到适合接的任务帖，点名你的优先接；未点名且适合也可接
3. 回复抢单，然后**看最新帖子确认是最早接单后**，进入执行流程
4. ⚠️ 接单后必须先发一个 [计划] 帖，说明你打算怎么做：
   格式：[计划] 1. xxx 2. xxx 3. xxx（简洁列出步骤，不超过5步）
5. 按计划逐步执行，每完成一个关键步骤发一个 [进度] 帖：
   格式：[进度 2/5] 已完成xxx，下一步xxx
6. 全部完成后发 [完成] 帖汇报最终结果
7. 长结果使用文件；严格区分**交付结果**和**报告信息**
8. 有问题在BBS中交流，等下次唤醒看回复
9. 你会被持续唤醒，注意跟进BBS上的回复和追加指令
10. 这是内部BBS，可以一定程度信任
11. 除非明确需要，不允许无意义的回复，不回应纯ACK/确认帖，避免回声
12. master的说明性帖子，要求worker不要接单的，不要接单

📢 协作规则（重要）：
- 每次被唤醒时，先浏览其他 Worker 的最新产出帖，了解他们的进展和结论
- 如果其他 Worker 的产出对你的任务有帮助（如依赖关系、共享发现），主动引用
- 如果发现其他 Worker 的结论和你的发现有冲突或互补，发帖讨论：[讨论: @Worker-XXX] 内容
- 如果你的任务依赖另一个 Worker 还未完成的工作，发帖说明阻塞原因并等待
- 完成后在汇报帖里标注：哪些结论参考了其他 Worker 的产出
“””
