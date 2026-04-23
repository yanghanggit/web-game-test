# web-game-test

Cocos Creator 3.8.8 Web 游戏，通过 Node.js 启动局域网 HTTP 服务器运行。

## 快速开始

```bash
# 安装依赖（首次）
npm install

# 启动服务器
npm start
```

启动后终端会打印本机所有可访问地址，例如：

```text
=== Cocos Game Server ===

  Local:   http://localhost:3000
  LAN:     http://192.168.x.x:3000
```

同一局域网内的手机或电脑直接访问 LAN 地址即可运行游戏。

## 自定义端口

```bash
PORT=8080 npm start
```

## 结构说明

| 路径 | 说明 |
| ------ | ------ |
| `server.js` | Node.js 静态文件服务器入口 |
| `web-mobile/` | Cocos Creator 编译输出的 Web 游戏产物 |
