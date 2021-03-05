process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});
process.env.NTBA_FIX_319 = 1;

Number.prototype.toFixedNumber = function (x, base) {
  const pow = Math.pow(base || 10, x);
  return +(Math.floor(this * pow) / pow);
};

Number.prototype.noExponents = function () {
  const data = String(this).split(/[eE]/);
  if (data.length == 1) return data[0];
  let z = ''; const sign = this < 0 ? '-' : '';
  const str = data[0].replace('.', '');
  let mag = Number(data[1]) + 1;
  if (mag < 0) {
    z = `${sign}0.`;
    while (mag++) z += '0';
    return z + str.replace(/^\-/, '');
  }
  mag -= str.length;
  while (mag--) z += '0';
  return str + z;
};

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const _ = require('lodash');
const moment = require('moment');
const ccxt = require('ccxt');
const Bottleneck = require('bottleneck');
const cluster = require('cluster');

const {
  loggingMessage, AsyncArray, isAmountOk, messageTrade, fetchCandle, writeDangling, writeBought, checkBuy, checkBalance, calculateAmount2Sell, commonIndicator, upTrend, smoothedHeikin, slowHeikin, obvOscillatorRSI, restart,
} = require('./helper');

const {
  apiKey, secret, password, telegramUserId, marketPlace, useFundPercentage, takeProfitPct, stopLossPct, useStableMarket, stableMarket, timeOrder, timeFrame, timeFrameStableMarket, exchangeID,
} = require('./config');

let delay = 0;
let lastScannedSymbol;
let shouldSkipAllSymbols = false;
let shouldEnableCounterDDOS = false;
const baseDelay = 1000;

const enhancedMarketPlace = marketPlace.toUpperCase();
const enhancedStableMarket = stableMarket.toUpperCase();
const enhancedExchangeID = exchangeID.toLowerCase();

const ultimateLimiter = new Bottleneck({
  maxConcurrent: 1,
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: delay,
});

if (cluster.isMaster) {
  cluster.fork();

  cluster.on('exit', () => {
    cluster.fork();
  });
} else {
  const telegram = new TelegramBot('Place your telegram bot token here');
  console.log('Please use your Telegram app and find @your_bot, and do not forget to tap /start in order for the bot to send messages to you');

  const exchange = new ccxt[enhancedExchangeID]({
    apiKey,
    secret,
    password,
    options: { adjustForTimeDifference: true, recvWindow: 10000, warnOnFetchOpenOrdersWithoutSymbol: false },
  });

  const takeProfit = (100 + takeProfitPct) / 100;
  const stopLoss = (100 - stopLossPct) / 100;

  (async function start() {
    try {
      const { bought, dangling } = await fs.readJSON('./trade.json');

      const checkMarketPlace = new RegExp(`${enhancedMarketPlace}$`, 'g');

      const ultimateExchange = new ccxt.binance({
        options: { adjustForTimeDifference: true, recvWindow: 10000, warnOnFetchOpenOrdersWithoutSymbol: false },
      });
      const ultimateMarkets = await ultimateExchange.fetchMarkets();
      const ultimateFilterMarkets = ultimateMarkets.filter(o => o.active === true && o.quote === enhancedMarketPlace);
      const ultimateFilterStableMarkets = ultimateMarkets.filter(o => o.active === true && o.quote === enhancedStableMarket);

      const markets = await exchange.fetchMarkets();
      const filterMarkets = markets.filter(o => o.active === true && o.quote === enhancedMarketPlace);
      const filterStableMarkets = markets.filter(o => o.active === true && o.quote === enhancedStableMarket);

      const commonMarkets = _.intersectionBy(filterMarkets, ultimateFilterMarkets, 'symbol');
      const commonStableMarkets = _.intersectionBy(filterStableMarkets, ultimateFilterStableMarkets, 'symbol');
      const differentMarkets = _.differenceBy(filterMarkets, ultimateFilterMarkets, 'symbol');
      const differentStableMarkets = _.differenceBy(filterStableMarkets, ultimateFilterStableMarkets, 'symbol');

      if (dangling.length > 0) {
        await Promise.all(dangling.map(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
          try {
            const { precision } = _.find(markets, o => o.symbol === pair);
            const {
              filled, status, symbol, price,
            } = await exchange.fetchOrder(id, pair);

            if (status === 'open') {
              await exchange.cancelOrder(id, pair);
            }

            const rate2Sell = price * takeProfit;
            const amount2Sell = await calculateAmount2Sell(exchange, pair, filled);
            const checkAmount = isAmountOk(pair, amount2Sell, rate2Sell, telegram, telegramUserId);

            if (filled > 0 && checkAmount) {
              const sellRef = await exchange.createLimitSellOrder(symbol, amount2Sell.toFixedNumber(precision.amount).noExponents(), rate2Sell.toFixedNumber(precision.price).noExponents());
              await writeBought(dangling, bought, pair, id, sellRef.id);
              console.log('Unresolved order, selling dangling order');
              messageTrade(sellRef, 'Sell', amount2Sell, symbol, rate2Sell, telegram, telegramUserId);
            } else {
              await writeBought(dangling, bought, pair, id);
              resolve();
            }
          } catch (e) {
            await writeBought(dangling, bought, pair, id);
          }
        }))));
      }

      const accountBalance = await exchange.fetchBalance();

      const marketPlaceBalance = !_.isUndefined(accountBalance.free[enhancedMarketPlace]) ? accountBalance.free[enhancedMarketPlace] * (useFundPercentage / 100) : 0;
      const stableCoinBalance = !_.isUndefined(accountBalance.free[enhancedStableMarket]) ? accountBalance.free[enhancedStableMarket] : 0;

      if (!checkBalance(enhancedMarketPlace, marketPlaceBalance) && !checkBalance(enhancedStableMarket, stableCoinBalance)) {
        console.log(`You have too small ${enhancedMarketPlace} or ${enhancedStableMarket}, please deposit more or cancel open order`);
        throw new Error('At check balance step');
      }

      if (useStableMarket) {
        const { precision: { amount, price } } = _.find(markets, o => o.symbol === `${enhancedMarketPlace}/${enhancedStableMarket}`);
        const {
          opens, highs, lows, closes,
        } = await fetchCandle(exchange, `${enhancedMarketPlace}/${enhancedStableMarket}`, timeFrameStableMarket);
        const { bid } = await exchange.fetchTicker(`${enhancedMarketPlace}/${enhancedStableMarket}`);
        const { shouldSellSlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);
        const historyOrder = await exchange.fetchMyTrades(`${enhancedMarketPlace}/${enhancedStableMarket}`);
        const isDoubleSellCheckOk = historyOrder.length === 0 ? true : _.last(historyOrder).side === 'buy';

        if (shouldSellSlowHeikin && checkBalance(enhancedMarketPlace, marketPlaceBalance) && isDoubleSellCheckOk) {
          const sellRef = await exchange.createLimitSellOrder(`${enhancedMarketPlace}/${enhancedStableMarket}`, marketPlaceBalance.toFixedNumber(amount).noExponents(), bid.toFixedNumber(price).noExponents());

          messageTrade(sellRef, 'Sell', marketPlaceBalance, `${enhancedMarketPlace}/${enhancedStableMarket}`, bid, telegram, telegramUserId);
        }
      }

      const marketPlaceInfo = await exchange.fetchTicker(`${enhancedMarketPlace}/${enhancedStableMarket}`);
      if (marketPlaceInfo.percentage >= 5 || marketPlaceInfo.percentage <= -7) {
        if (marketPlaceInfo.percentage >= 5) {
          console.log(`The ${enhancedMarketPlace} is going up too much, so it's better to pause for a while`);
        } else {
          console.log(`The ${enhancedMarketPlace} is going down too much, so it's better to pause for a while`);
        }
        throw new Error('At check is stable market step');
      }

      let scanMarkets = [];

      if (useStableMarket && checkBalance(enhancedMarketPlace, marketPlaceBalance) && checkBalance(enhancedStableMarket, stableCoinBalance)) {
        scanMarkets = { common: [...commonMarkets, ...commonStableMarkets], difference: [...differentMarkets, ...differentStableMarkets] };
      } else if (useStableMarket && checkBalance(enhancedStableMarket, stableCoinBalance)) {
        scanMarkets = { common: commonStableMarkets, difference: differentStableMarkets };
      } else if (checkBalance(enhancedMarketPlace, marketPlaceBalance)) {
        scanMarkets = { common: commonMarkets, difference: differentMarkets };
      }

      if (scanMarkets.common.length === 0 && scanMarkets.difference.length === 0) {
        console.log('Doesn\'t have anything to scan');
        throw new Error('At check pairs to scan step');
      }

      const openOrders = await exchange.fetchOpenOrders();

      if (openOrders.length >= 2) {
        console.log('Waiting for other open orders are filled');
        throw new Error('At check open orders step');
      }

      const candleCommonMarkets = await Promise.all(scanMarkets.common.map(({ symbol }) => ultimateLimiter.schedule(() => new Promise(async (resolve) => {
        try {
          // We got banned, skip all remain pairs
          if (!shouldSkipAllSymbols) {
            const boughtIndex = openOrders.findIndex(o => o.symbol === symbol);
            if (boughtIndex === -1) {
              const candles = await fetchCandle(ultimateExchange, symbol, timeFrame);
              const ticker = await ultimateExchange.fetchTicker(symbol);

              console.log(loggingMessage(`Scanning: ${symbol}`));

              resolve({
                pair: symbol, ...candles, ...ticker,
              });
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      }))));

      const lastScannedIndex = scanMarkets.difference.findIndex(o => o.symbol === lastScannedSymbol);
      const slicedScanDifferentMarkets = lastScannedIndex !== -1 ? scanMarkets.difference.slice(lastScannedIndex) : scanMarkets.difference;
      const slicedScanDifferentMarketsLength = slicedScanDifferentMarkets.length;

      const candleDifferentMarkets = await Promise.all(slicedScanDifferentMarkets.map(({ symbol }, index) => limiter.schedule(() => new Promise(async (resolve) => {
        try {
          // We we got banned, skip all remain pairs
          if (!shouldSkipAllSymbols) {
            // If we reach to the end of array then reset lastScannedSymbol

            if ((index + 1) === slicedScanDifferentMarketsLength) {
              lastScannedSymbol = null;
            }

            const boughtIndex = openOrders.findIndex(o => o.symbol === symbol);
            if (boughtIndex === -1) {
              const candles = await fetchCandle(exchange, symbol, timeFrame);
              const ticker = await exchange.fetchTicker(symbol);

              console.log(loggingMessage(`Scanning: ${symbol}`));
              lastScannedSymbol = symbol;

              if ((index + 1) === slicedScanDifferentMarketsLength) {
                lastScannedSymbol = null;
              }

              resolve({
                pair: symbol, ...candles, ...ticker,
              });
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (e) {
          if (e.message.includes('429')) {
            lastScannedSymbol = symbol;
            shouldSkipAllSymbols = true;
            shouldEnableCounterDDOS = true;
            if (shouldSkipAllSymbols) {
              limiter.updateSettings({
                maxConcurrent: 1,
                minTime: 0,
              });
            }

            resolve(null);
          } else {
            resolve(null);
          }
        }
      }))));

      const compactCandleMarkets = [..._.compact(candleCommonMarkets), ..._.compact(candleDifferentMarkets)];

      const listShouldBuy = await Promise.all(compactCandleMarkets.map(({
        pair, opens, highs, lows, closes, vols, last, bid, quoteVolume, percentage,
      }) => limiter.schedule(() => new Promise(async (resolve) => {
        try {
          const {
            baseRate, lastRSI, lastEMA, lastPSAR, spikyVal, changeBB, orderThickness, bidVol, askVol, closeDiff,
          } = await commonIndicator(exchange, highs, lows, closes, last, pair);
          const shouldBuyUpTrend = upTrend(opens, highs, lows, closes);
          const shouldBuySmmothedHeikin = smoothedHeikin(opens, highs, lows, closes, 14);
          const { shouldBuySlowHeikin } = slowHeikin(opens, highs, lows, closes, 6, 0.666, 0.0645);

          const OBVOscRSIVal = obvOscillatorRSI(closes, vols, 7);

          const volOscRSI = _.last(OBVOscRSIVal) - OBVOscRSIVal[OBVOscRSIVal.length - 2];
          const volDiff = bidVol / askVol;
          const volChecker = volDiff >= 0.75 || volOscRSI > 0;

          const lastClose = _.last(closes);

          const baseCondition = last >= 0.000001 && last <= lastEMA && spikyVal <= 3.5 && changeBB >= 1.08 && quoteVolume >= 1 && orderThickness >= 0.95 && volChecker && closeDiff <= 1.025;
          const strategyResult = loggingMessage(`Calculating Strategy: ${pair} - Result:`);

          if (last <= baseRate && lastRSI <= 35 && baseCondition) {
            console.log(strategyResult, 'SUCCESS');
            resolve({
              pair, percentage, bid, baseRate, method: 'Dip',
            });
          } else if (shouldBuySmmothedHeikin && lastPSAR <= lastClose && baseCondition) {
            console.log(strategyResult, 'SUCCESS');
            resolve({
              pair, percentage, bid, baseRate, method: 'Smoothed Heikin',
            });
          } else if (shouldBuySlowHeikin && lastPSAR <= lastClose && baseCondition) {
            console.log(strategyResult, 'SUCCESS');
            resolve({
              pair, percentage, bid, baseRate, method: 'Slow Heikin',
            });
          } else if (shouldBuyUpTrend && baseCondition) {
            console.log(strategyResult, 'SUCCESS');
            resolve({
              pair, percentage, bid, baseRate, method: 'Top',
            });
          } else {
            console.log(strategyResult, 'FAIL');
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      }))));

      const compactListShouldBuy = _.compact(listShouldBuy);

      if (compactListShouldBuy.length === 0) {
        console.log('There is nothing to buy at the moment');
        if (shouldEnableCounterDDOS) {
          throw new Error('429');
        }
        throw new Error('At check list should buy step');
      }

      if (compactListShouldBuy.length > 0) {
        const {
          pair, bid, baseRate, method,
        } = _.minBy(compactListShouldBuy, 'percentage');
        const { precision: { amount, price } } = _.find(markets, o => o.symbol === pair);
        let rate2Buy;

        rate2Buy = method === 'Dip' ? baseRate * 0.985 : bid * 0.99;
        if (rate2Buy > bid) {
          rate2Buy = bid;
        }

        const targetBalance = checkMarketPlace.test(pair) ? marketPlaceBalance : stableCoinBalance;

        const amount2Buy = (targetBalance / rate2Buy) * 0.9975;
        const buyRef = await exchange.createLimitBuyOrder(pair, amount2Buy.toFixedNumber(amount).noExponents(), rate2Buy.toFixedNumber(price).noExponents());

        await writeDangling(dangling, bought, pair, buyRef.id);
        messageTrade(buyRef, `Buy (${method})`, amount2Buy, pair, rate2Buy, telegram, telegramUserId);

        const buyFilled = await checkBuy(exchange, timeOrder, buyRef.id, pair, telegram, telegramUserId);

        if (buyFilled > 0) {
          const amount2Sell = await calculateAmount2Sell(exchange, pair, buyFilled);
          const rate2Sell = rate2Buy * takeProfit;
          const checkAmount = isAmountOk(pair, amount2Sell, rate2Sell, telegram, telegramUserId);

          if (checkAmount) {
            const sellRef = await exchange.createLimitSellOrder(pair, amount2Sell.toFixedNumber(amount).noExponents(), rate2Sell.toFixedNumber(price).noExponents());
            messageTrade(sellRef, 'Sell', amount2Sell, pair, rate2Sell, telegram, telegramUserId);
            await writeBought(dangling, bought, pair, buyRef.id, sellRef.id);
          }
        } else {
          throw new Error('At check bought or not');
        }
      }
      throw new Error('Everything is fine');
    } catch (e) {
      try {
        shouldSkipAllSymbols = false;
        shouldEnableCounterDDOS = false;

        const { dangling, bought } = await fs.readJSON('./trade.json');
        if (bought.length > 0) {
          const markets = await exchange.fetchMarkets();
          const waitSell = [];
          const boughtAsync = new AsyncArray(bought);
          const shouldStopLoss = await boughtAsync.filterAsync(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
            try {
              const { last } = await exchange.fetchTicker(pair);
              const {
                price, datetime, status, filled, amount,
              } = await exchange.fetchOrder(id, pair);

              const currentTime = moment();
              const targetTime = moment(datetime);
              const diffTime = moment.duration(currentTime.diff(targetTime)).asHours();
              const boughtRate = price / takeProfit;
              const stopLossPrice = boughtRate * stopLoss;

              if (status === 'closed') {
                const mess = loggingMessage(`Sold ${filled} ${pair} at rate = ${price}`);
                console.log(mess);
                telegram.sendMessage(telegramUserId, mess);
                resolve(false);
              } else if ((diffTime >= 24 && status === 'open') || (last <= stopLossPrice && diffTime >= 3 && status === 'open')) {
                const cancel = await exchange.cancelOrder(id, pair);
                console.log('Cancel the selling order');
                console.log(cancel);
                resolve(true);
              } else if (status === 'canceled' && amount > 0) {
                const re = /^\w+/;
                const [coin] = pair.match(re);
                const accountBalance = await exchange.fetchBalance();
                const coinBalance = !_.isUndefined(accountBalance.free[coin]) ? accountBalance.free[coin] : 0;

                if (coinBalance >= amount) {
                  console.log('The order is canceled but it wasn\'t sold. Reset the stop loss operation');
                  resolve(true);
                } else {
                  resolve(false);
                }
              } else {
                waitSell.push({ id, pair });
                resolve(false);
              }
            } catch (error) {
              waitSell.push({ id, pair });
              resolve(false);
              console.log(e.message, 'It could be due to internet connection problems, re-checking the order...');
            }
          })));

          const tempBought = shouldStopLoss.length > 0 ? await Promise.all(shouldStopLoss.map(({ id, pair }) => limiter.schedule(() => new Promise(async (resolve) => {
            try {
              const { precision } = _.find(markets, o => o.symbol === pair);
              const { amount, filled } = await exchange.fetchOrder(id, pair);
              const { bid } = await exchange.fetchTicker(pair);
              const rate2StopLoss = bid * 0.99;
              const remain = await calculateAmount2Sell(exchange, pair, amount - filled);
              const checkAmount = isAmountOk(pair, remain, rate2StopLoss, telegram, telegramUserId);

              if (checkAmount) {
                const stopLossRef = await exchange.createLimitSellOrder(pair, remain.toFixedNumber(precision.amount).noExponents(), rate2StopLoss.toFixedNumber(precision.price).noExponents());

                messageTrade(stopLossRef, 'Stop Loss', remain, pair, rate2StopLoss, telegram, telegramUserId);
                resolve({ id: stopLossRef.id, pair });
              } else {
                resolve(null);
              }
            } catch (error) {
              waitSell.push({ id, pair });
              resolve(null);
            }
          })))) : null;

          const newBought = [...waitSell, ..._.compact(tempBought)];
          await fs.writeJSON('./trade.json', { dangling, bought: newBought });
        }

        if (!e.message.includes('429')) {
          restart(start, e);
        } else {
          if (delay < 1000) {
            delay += baseDelay;
            limiter.updateSettings({
              maxConcurrent: 1,
              minTime: delay,
            });
          }
          restart(start, e);
        }
      } catch (error) {
        restart(start, error);
      }
    }
  }());
}
