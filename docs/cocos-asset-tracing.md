# Cocos Creator Web 构建产物资源追查方法论

## 背景

`web-mobile/` 是 Cocos Creator 编译输出的静态产物。资源文件以 UUID 命名，不保留原始文件名，初看难以定位。但 Cocos 有固定的组织规律，可按以下 3 步从"入口"追查到"实体文件"。

---

## 三步追查法

### 第一步 — 从 `config.json` 找 pack 索引

```text
assets/main/config.json
```

关注 `packs` 字段，它记录了各 pack 文件名与其包含的资源 UUID 索引的映射：

```json
"packs": { "011d79eb0": [1, 4] }
```

pack 文件名即对应 `import/` 目录下的 JSON 文件路径（取前两位作为子目录）：

```text
assets/main/import/01/011d79eb0.json
```

### 第二步 — 读 pack 文件，找 UUID 与资源名

pack 文件是 Cocos 场景/资源的序列化数据。打开后可读取到：

- 节点名（如 `"name": "fake-news"`）
- 绑定的组件类型（如 `cc.Sprite`、`cc.SpriteFrame`）
- 资源 UUID（短码形式，如 `b2wESvIkxJNoPy2lr91uoK`）

UUID 短码与完整 UUID 的对应关系在 `config.json` 的 `uuids` 数组中：

```json
"uuids": ["011d79eb0", "8bvPxf6qFN1...", "b2wESvIkxJNoPy2lr91uoK", ...]
```

完整 UUID 以 Base64 编码存储，实际文件名是其解码后的标准 UUID 格式：

```text
b2wESvIkxJNoPy2lr91uoK  →  b2c044af-224c-4936-83f2-da5afdd6ea0a
```

### 第三步 — 按 UUID 前两位在 `native/` 目录定位实体文件

Cocos 将原始二进制资源（jpg/png/wasm 等）按 UUID **前两位**分目录存放：

```text
assets/main/native/<UUID前两位>/<完整UUID>.<扩展名>
```

示例：

```text
assets/main/native/b2/b2c044af-224c-4936-83f2-da5afdd6ea0a.jpg
```

---

## 目录对应关系速查

| 目录 | 内容 |
| ------ | ------ |
| `assets/main/config.json` | 资源索引、UUID列表、pack映射 |
| `assets/main/import/<前两位>/` | 元数据 JSON（SpriteFrame裁剪信息、场景描述等） |
| `assets/main/native/<前两位>/` | 实体二进制文件（图片、音频、wasm等） |

`internal/` 包结构相同，存放引擎内置资源（Shader、Material 等）。

---

## 补充：快速搜索 vs 结构追查

| 方法 | 适用场景 |
| ------ | --------- |
| 关键字搜索（grep） | 已知资源名，快速定位 |
| 结构追查（本文方法） | 不知道资源名，或需要理解资源之间的依赖关系 |

建议**优先用结构追查**，既能理解依赖，也能发现意外的资源引用。

---

## Agent 使用原则（重要）

> 本节面向 AI Agent，约束其如何使用本文方法。

### 必须做：从结构出发，从零发现

1. 从 `config.json` 读 `packs` 字段，枚举所有 pack 文件
2. 解析每个 pack 文件，提取短 UUID 与节点名信息
3. 将短 UUID 解码为完整 UUID，按前两位定位 `native/` 目录下的实体文件
4. 把**完整资产目录**（UUID + 节点名 + 文件路径）作为决策依据

### 禁止做：依赖先验知识走捷径

- ❌ 直接用已知节点名（如 `fake-news`）作为搜索关键词
- ❌ 用 `find_asset('fake-news')` 这类"先猜名字再匹配"的调用作为第一步
- ❌ 跳过结构遍历，直接构造 native 路径

### 为什么这样规定

游戏资源的节点名在每个项目、每次构建中都不同。Agent 只有通过结构追查，才能成为**适用于任意 Cocos 项目的通用解**——而不是依赖对当前项目的先验记忆来取巧。

允许多次工具调用。先枚举全量资产，再依据用户意图从目录中选目标，是正确且鼓励的做法。
