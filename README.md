# 呵气 · 窗外

冬夜，你坐在车里。车窗结满雾气——擦开一道，看见外面的雨。
对着麦克风呵一口气让雾更厚，再把手掌贴上去：掌印融穿玻璃，你就到外面了。

灵感与结构来自 [touch the water](https://water-journey-self.vercel.app/)，
换了一扇完全不同的膜。

## 运行

零构建，静态文件直接跑：

```sh
python -m http.server 8077 --directory .
# 打开 http://localhost:8077/
```

部署即扔到任何静态托管（Vercel/Netlify/GitHub Pages）。
麦克风需要 https 或 localhost。

## 玩法

| 幕 | 操作 |
|---|---|
| 车窗 | 按住拖动＝擦雾 · 对麦克风呵气（或按住 `空格`）＝蒙雾 · 雾厚处按住不动＝手掌贴上去，融穿 |
| 窗外 | 拖动＝环顾 · `WASD`＝走在水面上 · `空格`/呵气＝呼出白气 · 左上角「回到玻璃后」返回 |

雾会慢慢回来；水珠在呵气处凝出、顺着玻璃往下淌。回来时，你擦过的痕迹还在。
窗外是一座黑夜里的废墟之城：整条街是一面水镜，走一步荡开一圈波纹，
月亮和亮着的窗都倒在水里。快撞到东西会自己偏开，走到尽头会慢慢转回来。

## 开发

- `?act=window` / `?act=world` 跳幕（静音、指针模式）
- `#debug` 左下角调试面板
- 控制台 `fogDev.breathe(2)` 模拟呵气、`fogDev.dive()` 融穿、`fogDev.surface()` 回程、
  `fogDev.lantern()` 召一盏灯笼、`fogDev.tp(x,z,yaw,pitch)` 传送取景、`fogDev.freeze(0.3)` 冻结穿越进度

## 结构

```
src/
  config.js    全部手感参数
  fogfield.js  雾密度场(GPU ping-pong + CPU 影子格网)
  droplets.js  水珠粒子(凝结、下淌、尾迹)
  breath.js    呼吸输入(麦克风谱平坦度判定 / 空格降级)
  intent.js    输入意图层(擦拭笔划、手掌按贴、拖动)
  palmprint.js 程序化掌印纹理
  windowact.js 车窗幕(透雾合成、水珠透镜、掌印预览)
  crossing.js  融穿/结霜转场
  world.js     窗外世界总装(路灯、雨、贩卖机、导航与邂逅)
  mirrorwater.js 水镜地面(波纹模拟 + 平面反射)
  ruins.js     废墟之城(楼影、亮窗、断拱、灯笼、月亮)
  steering.js  避障与空气墙转向
  audio.js     全合成音频(车内闷雨⇄车外亮雨只隔一个低通滤波器)
  main.js      状态机与三级文案系统
```
