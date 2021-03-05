# TRADING BOT   (version 0.2.5)


> A trading bot for trading on various exchanges. 

## **Description**

USE AT YOUR OWN RISK. THIS TRADES REAL MONEY. NO WARRANTY IS GIVEN

With this trading bot you can set how much of your crypto balance you would like to trade with. Change how long to give the bot to complete a trade sequence. ( i.e. 30 minutes, can be changed in config.json). It can be used to trade on the stable coin/token markets, it also sends notifications of any trades via telegram. Set which base coin/token to use. Set the profit target you want reach. You can have more than one instance running at a time. It trades using your API keys. You can set a stop loss (as a percentage). Change the chart timeframe the bot searches for trades on. Works on various exchanges i.e. Binance, kucoin. Please let me know what other exchanges you have tried that works. It calculates the best time to buy a coin/token based on a strategy (using Technical Indicators), and then sells for a profit. I use the Crypto Balancer to keep my portfolio at the levels I like. https://github.com/ebinum83/crypto_balancer . This app requires nodejs to be installed. Let me know what you think of this bot. Please fork, clone and edit.



## Set up bot

---

### **Create config files**

```bash
cp config.json.sample config.json
```
```bash
cp trade.json.sample trade.json
```

---

---

### **Configure settings**

- Configure the bot settings in config.json to your own specifications.

- Here is a description of each setting.

```
marketPlace = The base coin/token to trade. "string" The symbol of the coin/token
useFundPercentage = How much of your balance to use for trading as a percantage. (integer)
takeProfitPct = Sets a profit target as a percentage. (integer)
stopLossPct = Sets a stop loss as a percentage. (integer)
useStableMarket = Wether to use the stable coin/token markets. (true OR false)
stableMarket = Stable coin/token market to trade on. "string"
timeOrder = How long the trade will continue before the bot will sell (integer)
timeFrame = The chart timeframe the bot will use to search for possible trades. "string"
timeFrameStableMarket = The stable market chart timeframe the bot will use to search for possible trades. "string"
exchangeID = The exchange to trade on. "string" The exhange name that ccxt uses.
```

---

---

### **API Keys**

- The bot needs your exchange API Keys in order to trade.

- Do not not enable deposit/withdrawal for the API key.

```
1. Login to your exchange and create an API Key.
2. Copy your API Key/Secret, and paste them in config.json (on lines 2 & 3).
3. If you Exchange supports it, copy & paste your password into config.json (on line 4).
```

---

---

### **Telegram Notifications**

- In order to receive notifications via Telegram, you need to setup your bot token and userid.

```
1. Open Telegram and search for Botfather, and create a bot. 
2. Copy the API token and paste it into app.js (on line 69).
3. Go to Telegram and search for Json Dump Bot, then type something and press send.
4. Copy and paste the ChatId into config.json (on line 5).
```

---

---

### **Installation**

- This app requires nodejs to be installed.

```bash
nvm install --lts
```

- Choose a folder on your system and change directory to it in the terminal.

```bash
cd [folder path]
```

---

---

- In order to install the app and all dependencies, go to the app folder in the terminal and run:

```bash
npm install
```

---

---

### Start the app

- In the terminal run:

```bash
npm start
```

---

### **Author**

ebinum83             <img src="https://avatars.githubusercontent.com/u/51938742?s=460&v=4" style="zoom:25%;" />

### **Licence**

### **BSD-3-Clause**

Copyright © <2021> by ebinum83 <ebinum83@outlook.com> All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
    3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.