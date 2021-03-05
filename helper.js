const _ = require('lodash');
const fs = require('fs-extra');
const moment = require('moment');
const {
  BollingerBands, RSI, EMA, OBV, MACD, SMA, PSAR, HeikinAshi, Stochastic,
} = require('technicalindicators');

function loggingMessage(msg) {
  return `[${moment().format('HH:mm:ss DD/MM/YYYY')}] - ${msg}`;
}

class AsyncArray extends Array {
  constructor(arr) {
    super();
    this.data = arr;
  }

  filterAsync(predicate) {
    const data = Array.from(this.data);
    return Promise.all(data.map((element, index) => predicate(element, index, data)))
      .then(result => data.filter((element, index) => result[index]));
  }
}

async function fetchCandle(exchange, symbol, timeFrame) {
  const candle = await exchange.fetchOHLCV(symbol, timeFrame);
  const candleLength = candle.length;
  const times = []; const opens = []; const highs = []; const lows = []; const closes = []; const vols = [];

  candle.map(([time, open, high, low, close, vol]) => {
    times.push(time);
    opens.push(open);
    highs.push(high);
    lows.push(low);
    closes.push(close);
    vols.push(vol);
  });

  return {
    times, opens, highs, lows, closes, vols, candleLength,
  };
}

async function writeDangling(dangling, bought, pair, id) {
  dangling.push({ pair, id });
  await fs.writeJSON('./trade.json', { dangling, bought });
}

async function writeBought(dangling, bought, pair, buyId, sellId = null) {
  const filterDangling = dangling.filter(o => o.id !== buyId);
  if (sellId !== null) {
    bought.push({
      id: sellId, pair,
    });
  }
  await fs.writeJSON('./trade.json', { dangling: filterDangling, bought });
}

async function checkBuy(exchange, timeOrder, id, pair, telegram, telegramUserId) {
  const timeBuy = moment();
  let buyRef;
  const buyFilled = await new Promise((resolve) => {
    const checkBuyInterval = setInterval(async () => {
      try {
        const currentTime = moment();
        const diffTime = moment.duration(currentTime.diff(timeBuy)).asMinutes();
        const ref = await exchange.fetchOrder(id, pair);
        const { status, filled } = ref;
        buyRef = ref;

        if (status === 'closed') {
          resolve(filled);
          clearInterval(checkBuyInterval);
        } else if (diffTime >= timeOrder && status === 'open') {
          await exchange.cancelOrder(id, pair);

          const mess = loggingMessage(`Cancel the order: ${pair} due to exceed ${timeOrder} mins`);

          console.log(mess);
          telegram.sendMessage(telegramUserId, mess);

          resolve(filled);
          clearInterval(checkBuyInterval);
        }
      } catch (e) {
        console.log(e.message, 'It could be due to internet connection problems, re-checking the order...');
      }
    }, 300000);
  });

  if (buyFilled > 0) {
    const { price } = buyRef;
    telegram.sendMessage(telegramUserId, loggingMessage(`Bought ${buyFilled} ${pair} at rate = ${price}`));
  }

  return buyFilled;
}

function checkBalance(marketName, marketBalance) {
  let isAboveRequiredBalance = false;

  if (marketName === 'BTC') {
    isAboveRequiredBalance = marketBalance >= 0.001;
  } else if (marketName === 'ETH') {
    isAboveRequiredBalance = marketBalance >= 0.01;
  } else if (marketName === 'BNB') {
    isAboveRequiredBalance = marketBalance >= 0.1;
  } else {
    isAboveRequiredBalance = marketBalance >= 10;
  }

  return isAboveRequiredBalance;
}

function restart(start, e) {
  if (e.message.includes('429')) {
    setTimeout(() => {
      start.call(this);
    }, 90000);
  } else {
    console.log(e.message);
    console.log('Resetting...');
    setTimeout(() => {
      start.call(this);
    }, 60000);
  }
}

function messageTrade(ref, side, amount, pair, rate, telegram, telegramUserId) {
  const mess = loggingMessage(`${side}: ${amount} ${pair} at rate = ${rate}`);
  console.log(mess);
  console.log(ref);
  telegram.sendMessage(telegramUserId, mess);
}

async function commonIndicator(exchange, highs, lows, closes, last, pair) {
  const closeDiff = _.last(closes) / closes[closes.length - 2];

  const BBVal = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });

  const EMAVal = EMA.calculate({ period: 150, values: closes });

  const RSIVal = RSI.calculate({ period: 14, values: closes });

  const PSARVal = PSAR.calculate({
    step: 0.0001,
    max: 0.2,
    high: highs,
    low: lows,
  });

  const lastPSAR = _.last(PSARVal);
  const lastBB = _.last(BBVal);
  const lastRSI = _.last(RSIVal);
  const lastEMA = _.last(EMAVal);
  const changeBB = lastBB.upper / lastBB.lower;
  const baseRate = lastBB.lower * 0.99;

  const minRate = _.min(closes);
  const spikyVal = last / minRate;

  const { bids, asks } = await exchange.fetchOrderBook(pair);

  const limitBidOrderBook = bids.length > 10 ? 10 : bids.length;
  const limitAskOrderBook = asks.length > 10 ? 10 : asks.length;

  const bidVol = _.sum(bids.slice(0, limitBidOrderBook).map(([rate, vol]) => vol));

  const askVol = _.sum(asks.slice(0, limitAskOrderBook).map(([rate, vol]) => vol));

  const orderThickness = bids[limitBidOrderBook - 1][0] / bids[0][0];

  return {
    baseRate, lastRSI, lastEMA, lastPSAR, spikyVal, changeBB, orderThickness, bidVol, askVol, closeDiff,
  };
}

function upTrend(opens, highs, lows, closes) {
  const lastOpen = _.last(opens);
  const lastClose = _.last(closes);
  const thirdLastClose = closes[closes.length - 3];

  const lastCandle = closes[closes.length - 1] - opens[opens.length - 1];
  const secondLastCandle = closes[closes.length - 2] - opens[opens.length - 2];

  const RSIVal = RSI.calculate({
    values: closes,
    period: 14,
  });
  const lastRSI = _.last(RSIVal);
  const secondLastRSI = RSIVal[RSIVal.length - 2];

  const MACDVal = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const lastMACD = _.last(MACDVal);
  const secondLastMACD = MACDVal[MACDVal.length - 2];
  const thirdLastMACD = MACDVal[MACDVal.length - 3];
  const macdCheck = lastMACD.MACD > lastMACD.signal && secondLastMACD.MACD > secondLastMACD.signal && thirdLastMACD.MACD < thirdLastMACD.signal;

  const stochVal = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  });

  const lastStoch = _.last(stochVal);
  const secondStoch = stochVal[stochVal.length - 2];
  const thirdStoch = stochVal[stochVal.length - 3];
  const lastK = lastStoch.k;
  const lastD = lastStoch.d;
  const secondLastK = secondStoch.k;
  const secondLastD = secondStoch.d;
  const thirdLastK = thirdStoch.k;
  const thirdLastD = thirdStoch.d;
  const stochCheck = lastK > lastD && secondLastK > secondLastD && thirdLastK < thirdLastD;

  const maRedVal = SMA.calculate({ period: 5, values: closes });
  const maBlueVal = SMA.calculate({ period: 14, values: closes });
  const lastMaRed = _.last(maRedVal);
  const lastMaBlue = _.last(maBlueVal);
  const secondLastMaRed = maRedVal[maRedVal.length - 2];
  const secondLastMaBlue = maBlueVal[maBlueVal.length - 2];
  const thirdLastMaRed = maRedVal[maRedVal.length - 3];
  const thirdLastMaBlue = maBlueVal[maBlueVal.length - 3];
  const maCheck = lastMaRed > lastMaBlue && secondLastMaRed > secondLastMaBlue && thirdLastMaRed < thirdLastMaBlue;

  const BBVal = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });
  const lastBB = _.last(BBVal);
  const thirdLastBB = BBVal[BBVal.length - 3];
  const bbCheck = lastCandle > 0 && secondLastCandle > 0 && thirdLastClose <= thirdLastBB.lower;

  const PSARVal = PSAR.calculate({
    step: 0.0001,
    max: 0.2,
    high: highs,
    low: lows,
  });
  const lastPSAR = _.last(PSARVal);

  const pastBaseCondition = secondLastRSI <= 20 || (secondLastRSI >= 50 && secondLastRSI <= 80);
  const currentBaseCondition = lastRSI <= 20 || (lastRSI >= 50 && lastRSI <= 80);

  const buyIndicatorTest = [macdCheck, stochCheck, maCheck, bbCheck];
  const buyIndicatorAccumulator = buyIndicatorTest.reduce((accumulate, current) => {
    if (current) {
      return accumulate + 1;
    }
    return accumulate;
  }, 0);

  const shouldBuy = currentBaseCondition && pastBaseCondition && lastOpen <= lastBB.upper && lastPSAR <= lastClose && buyIndicatorAccumulator >= 2;
  return shouldBuy;
}

async function calculateAmount2Sell(exchange, pair, orgAmount) {
  const balance = await exchange.fetchBalance();
  const re = /^\w+/;
  const [coin] = pair.match(re);
  const availableCoin = balance.free[coin];
  const isHasBNB = Object.keys(balance).findIndex(o => o === 'BNB');
  let enhancedAmount = orgAmount > availableCoin ? availableCoin : orgAmount;
  if (isHasBNB !== -1) {
    const bnbFree = balance.free.BNB;
    if (bnbFree === 0) {
      enhancedAmount = orgAmount > availableCoin ? availableCoin * 0.9975 : orgAmount * 0.9975;
    }
  }
  return enhancedAmount;
}

function isAmountOk(pair, amount, rate, telegram, telegramUserId) {
  let checkAmount = true;
  const re = /\w+$/;
  const [marketPlace] = pair.match(re);

  if (marketPlace === 'BTC') {
    checkAmount = (amount * rate) >= 0.001;
  } else if (marketPlace === 'ETH') {
    checkAmount = (amount * rate) >= 0.01;
  } else if (marketPlace === 'BNB') {
    checkAmount = (amount * rate) >= 0.1;
  } else {
    checkAmount = (amount * rate) >= 10;
  }

  if (!checkAmount && amount !== 0) {
    const mess = loggingMessage(`The order ${pair} is invalid due to too small, please consider to manually buy/sell it`);
    telegram.sendMessage(telegramUserId, mess);
  }

  return checkAmount;
}

function smoothedCandle(opens, highs, lows, closes, period) {
  const smoothedOpens = EMA.calculate({
    values: opens,
    period,
  });

  const smoothedHighs = EMA.calculate({
    values: highs,
    period,
  });

  const smoothedLows = EMA.calculate({
    values: lows,
    period,
  });

  const smoothedCloses = EMA.calculate({
    values: closes,
    period,
  });

  return {
    smoothedOpens, smoothedHighs, smoothedLows, smoothedCloses,
  };
}

function smoothedHeikin(opens, highs, lows, closes, period) {
  const {
    smoothedOpens, smoothedHighs, smoothedLows, smoothedCloses,
  } = smoothedCandle(opens, highs, lows, closes, period);

  const { open, close } = HeikinAshi.calculate({
    open: smoothedOpens,
    high: smoothedHighs,
    low: smoothedLows,
    close: smoothedCloses,
  });

  const RSIVal = RSI.calculate({
    values: close,
    period: 14,
  });
  const lastRSI = _.last(RSIVal);

  const enhancedOpens = EMA.calculate({
    values: open,
    period,
  });

  const enhancedCloses = EMA.calculate({
    values: close,
    period,
  });

  const candleLength = enhancedCloses.length;

  const numCandleScan = 5;
  const targetIndex = candleLength - numCandleScan - 3;

  let redCount = 0;
  for (let index = candleLength - 3; index > targetIndex; index--) {
    const targetCandle = enhancedCloses[index] - enhancedOpens[index];
    if (targetCandle < 0) {
      redCount += 1;
    }
  }

  const diffRSI = lastRSI >= 50 || lastRSI <= 40;

  const isCompletedHeikinCandleGreen = (enhancedCloses[candleLength - 2] - enhancedOpens[candleLength - 2]) > 0;

  const shouldBuy = redCount === numCandleScan && isCompletedHeikinCandleGreen && diffRSI;

  return shouldBuy;
}

function kama(smoothedCloses, fastEnd, slowEnd) {
  const kamaVal = [];
  const currentClose = smoothedCloses[smoothedCloses.length - 1];
  const smooth = ((fastEnd - slowEnd) + slowEnd) ** 2;
  smoothedCloses.map((close) => {
    const previousKama = kamaVal.length > 0 ? _.last(kamaVal) : currentClose;
    const currentKama = previousKama + smooth * (close - previousKama);
    kamaVal.push(currentKama);
  });
  return kamaVal;
}

function slowHeikin(opens, highs, lows, closes, period, fastEnd, slowEnd) {
  const {
    open, high, low, close,
  } = HeikinAshi.calculate({
    open: opens,
    high: highs,
    low: lows,
    close: closes,
  });

  const {
    smoothedOpens, smoothedHighs, smoothedLows, smoothedCloses,
  } = smoothedCandle(open, high, low, close, period);

  const slowHeikinCandle = HeikinAshi.calculate({
    open: smoothedOpens,
    high: smoothedHighs,
    low: smoothedLows,
    close: smoothedCloses,
  });

  const RSIVal = RSI.calculate({
    values: slowHeikinCandle.close,
    period: 14,
  });
  const lastRSI = _.last(RSIVal);

  const heikinOpen = kama(slowHeikinCandle.close, fastEnd, slowEnd);

  const candleLength = slowHeikinCandle.close.length;

  const isCompletedHeikinCandleGreen = (slowHeikinCandle.close[candleLength - 2] - heikinOpen[candleLength - 2]) > 0;
  const isPreviousHeikinCandleGreen = (slowHeikinCandle.close[candleLength - 3] - heikinOpen[candleLength - 3]) > 0;

  const diffRSI = lastRSI >= 50 || lastRSI <= 40;

  const numCandleScan = 5;
  const targetIndex = candleLength - numCandleScan - 3;

  let redCount = 0;
  for (let index = candleLength - 3; index > targetIndex; index--) {
    const targetCandle = slowHeikinCandle.close[index] - heikinOpen[index];
    if (targetCandle < 0) {
      redCount += 1;
    }
  }

  const shouldBuySlowHeikin = isCompletedHeikinCandleGreen && !isPreviousHeikinCandleGreen && redCount === numCandleScan && diffRSI;
  const shouldSellSlowHeikin = !isCompletedHeikinCandleGreen && isPreviousHeikinCandleGreen && diffRSI;

  return {
    shouldBuySlowHeikin, shouldSellSlowHeikin,
  };
}

function obvOscillatorRSI(closes, vols, period = 7) {
  const OBVVal = OBV.calculate({
    close: closes,
    volume: vols,
  });

  const smoothedOBVVal = EMA.calculate({
    values: OBVVal,
    period,
  });

  const OBVOscVal = smoothedOBVVal.map((value, index) => OBVVal[index + period - 1] - value);

  const OBVOscRSIVal = RSI.calculate({ period, values: OBVOscVal });

  return OBVOscRSIVal;
}

module.exports = {
  loggingMessage, AsyncArray, isAmountOk, messageTrade, fetchCandle, writeDangling, writeBought, checkBuy, checkBalance, commonIndicator, upTrend, calculateAmount2Sell, smoothedHeikin, slowHeikin, obvOscillatorRSI, restart,
};
