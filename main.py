# -*- coding: UTF-8 -*-
from pandas import read_csv
import math


def run(inputData):

    A = inputData[0]
    B = inputData[1]
    C = inputData[2]
    n = 512
    money = 10000

    def Commission(cost):
        return int(math.ceil(cost*0.05))

    def Sell(status, price):
        return int(price * status[0] + status[1] - Commission(status[0] * price))

    def Buy(totalMoney, price):
        n = min((totalMoney/1.05)//price,10000)
        if price * n + Commission(price * n) > totalMoney: n -= 1
        return [int(n), int(totalMoney - price * n - Commission(price * n))]

    def BuySome(totalMoney, price, n):
        return [int(n), int(totalMoney - price * n - Commission(price * n))]

    def SellToGet(needMoney, price):
        if needMoney <= 0: return 0
        n = (needMoney/1.05)//price
        while price * n - Commission(price * n) < needMoney: n += 1
        return n

    def MergeTrades(trade1,trade2):
        # trade1,trade2 is sorted [333, 'buy', 'B', 1, 82], [333, 'sell', 'B', 1, 1661]
        trade1 = trade1[::-1]
        trade2 = trade2[::-1]
        res = []
        buySell = {'buy':'sell','sell':'buy'}
        while trade1 and trade2:
            if trade1[-1] < trade2[-1]: res.append(trade1.pop())
            else: res.append(trade2.pop())
            if len(res) >= 2 and res[-1][0] == res[-2][0] and res[-1][2] == res[-2][2]:
                if res[-1][1] == res[-2][1]:
                    res[-2][3] += res[-1][3]
                    res.pop()
                else:
                    res[-2][3] -= res[-1][3]
                    res.pop() # 弹出去了
                    if res[-1][3] == 0: res.pop()
                    elif res[-1][3] < 0:
                        res[-1][3] = - res[-1][3]
                        res[-1][1] = buySell[res[-1][1]]
        if trade1: res += trade1[::-1]
        if trade2: res += trade2[::-1]
        return res

    def SimpleSell(share,restMoney,price):
        return int(price * share + restMoney - Commission(price * share))

    def SimpleBuy(share,totalMoney,price):
        return int(totalMoney - price * share - Commission(price * share))

    def Calculate(X,name):
        dp = [[0,0] for _ in range(n)] # 不持有的金额 和 持有10000股的剩下的金额
        dp[-1][1] = -999999999
        log = [{'V':[],'H':[]} for _ in range(n)]
        for i in range(n):
            dp[i][0] = max(dp[i-1][0],SimpleSell(10000,dp[i-1][1],X[i]))
            if dp[i][0] == dp[i-1][0]: log[i]['V'] = log[i-1]['V']
            else: log[i]['V'] = log[i-1]['H'] + [[i,'sell',name, 10000]]
            dp[i][1] = max(dp[i-1][1],SimpleBuy(10000,dp[i][0],X[i]))
            if dp[i][1] == dp[i-1][1]: log[i]['H'] = log[i-1]['H']
            else: log[i]['H'] = log[i]['V'] + [[i,'buy',name, 10000]]
        return log[n-1]['V']

    def logToReport(logs):
        for log in logs:
            print(log[1]+'('+log[2]+','+str(log[0])+','+str(log[3])+');')

    def CutTradeTo(end,trades):
        while trades and trades[-1][0] > end:
            trades.pop()
        while trades and trades[-1][1] == 'buy':
            trades.pop()
        return trades

    def CutTradeFrom(start,trades):
        trades = trades[::-1]
        while trades and trades[-1][0] < start:
            trades.pop()
        while trades and trades[-1][1] == 'sell':
            trades.pop()
        return trades[::-1]

    def TestTrades(trades):
        # trades should be sorted and sell is before buy in the same day
        money = 10000
        for trade in trades:
            if trade[1] == 'buy': money = SimpleBuy(trade[3],money,stockMap[trade[2]][trade[0]])
            if trade[1] == 'sell': money = SimpleSell(trade[3],money,stockMap[trade[2]][trade[0]])
            if money < 0: return -1
        return money

    # 每天有4种状态，满A，满B，满C，空仓
    # 每天先卖出，再买入
    # 相同状态的比较按照当天股价计算资产

    result = []

    stockMap = {'A':A,'B':B,'C':C}
    dp = [{'A':[0,0],'B':[0,0],'C':[0,0],'V':[0,0]} for _ in range(n+1)]
    dp[-1]['V'][1] = 10000 # 钱初始化
    # 每天钱的变动，主要在第二次dp之后起效
    change = [0] * (n+1)
    # 每天股票持有状态
    hold = [{'A':0,'B':0,'C':0} for _ in range(n+1)]
    # 记录交易过程
    log = [{'A':[],'B':[],'C':[],'V':[]} for _ in range(n+1)]


    for turn in range(3):
        for i in range(n):
            # 先卖出，先算V

            dp[i]['V'][1] = max(Sell(dp[i-1]['A'],A[i]),Sell(dp[i-1]['B'],B[i]),Sell(dp[i-1]['C'],C[i]),dp[i-1]['V'][1])
            if dp[i]['V'][1] == dp[i-1]['V'][1]: log[i]['V'] = log[i-1]['V']
            elif dp[i]['V'][1] == Sell(dp[i-1]['A'],A[i]): log[i]['V'] = log[i-1]['A'] + [[i,'sell', 'A', dp[i-1]['A'][0]]]
            elif dp[i]['V'][1] == Sell(dp[i-1]['B'],B[i]): log[i]['V'] = log[i-1]['B'] + [[i,'sell', 'B', dp[i-1]['B'][0]]]
            elif dp[i]['V'][1] == Sell(dp[i-1]['C'],C[i]): log[i]['V'] = log[i-1]['C'] + [[i,'sell', 'C', dp[i-1]['C'][0]]]

            dp[i]['V'][1] += change[i]

            # 再买入

            # 上次是A，这次还是A,不会再买入,不过可能卖出填补不足的钱或者股数大于10000
            if dp[i - 1]['A'][1] + change[i] >= 0 and dp[i - 1]['A'][0] + hold[i]['A'] <= 10000:
                share1, money1 = dp[i - 1]['A']
                money1 += change[i]
                log1 = log[i - 1]['A']
            else:
                if Sell(dp[i - 1]['A'], A[i]) + change[i] < 0: # 无论如何填补不了
                    share1, money1 = dp[i]['V']
                    log1 = log[i]['V']
                else:
                    needToSell = max(dp[i - 1]['A'][0] + hold[i]['A'] - 10000, 0, SellToGet(-(dp[i - 1]['A'][1] + change[i]), A[i])) # 需要卖的部分
                    if needToSell > dp[i - 1]['A'][0]: # 需要卖的太多，大于已经持有的了，直接回到V状态
                        share1, money1 = dp[i]['V']
                        log1 = log[i]['V']
                    else:
                        share1, money1 = dp[i - 1]['A'][0] - needToSell, Sell([needToSell, dp[i - 1]['A'][1]], A[i]) + change[i]
                        log1 = log[i - 1]['A'] + [[i,'sell', 'A', needToSell]]

            # 上次是V，这次是A,直接用上面算好的V
            needToBuy = min(Buy(dp[i]['V'][1], A[i])[0], 10000 - hold[i]['A'])
            share2, money2 = BuySome(dp[i]['V'][1],A[i],needToBuy)
            log2 = log[i]['V'] + [[i,'buy', 'A', needToBuy]]

            # 比较
            if share1 > share2 or share1 == share2 and money1 > money2:
                dp[i]['A'] = [share1,money1]
                log[i]['A'] = log1
            else:
                dp[i]['A'] = [share2, money2]
                log[i]['A'] = log2

            # 上次是B，这次还是B,不会再买入,不过可能卖出填补不足的钱或者股数大于10000
            if dp[i - 1]['B'][1] + change[i] >= 0 and dp[i - 1]['B'][0] + hold[i]['B'] <= 10000:
                share1, money1 = dp[i - 1]['B']
                money1 += change[i]
                log1 = log[i - 1]['B']
            else:
                if Sell(dp[i - 1]['B'], B[i]) + change[i] < 0:  # 无论如何填补不了
                    share1, money1 = dp[i]['V']
                    log1 = log[i]['V']
                else:
                    needToSell = max(dp[i - 1]['B'][0] + hold[i]['B'] - 10000, 0,SellToGet(-(dp[i - 1]['B'][1] + change[i]), B[i]))  # 需要卖的部分
                    if needToSell > dp[i - 1]['B'][0]:
                        share1, money1 = dp[i]['V']
                        log1 = log[i]['V']
                    else:
                        share1, money1 = dp[i - 1]['B'][0] - needToSell, Sell([needToSell, dp[i - 1]['B'][1]], B[i]) + change[i]
                        log1 = log[i - 1]['B'] + [[i, 'sell', 'B', needToSell]]


            # 上次是V，这次是B,直接用上面算好的V
            needToBuy = min(Buy(dp[i]['V'][1], B[i])[0], 10000 - hold[i]['B'])
            share2, money2 = BuySome(dp[i]['V'][1], B[i], needToBuy)
            log2 = log[i]['V'] + [[i, 'buy', 'B', needToBuy]]

            # 比较
            if share1 > share2 or share1 == share2 and money1 > money2:
                dp[i]['B'] = [share1, money1]
                log[i]['B'] = log1
            else:
                dp[i]['B'] = [share2, money2]
                log[i]['B'] = log2

            # 上次是C，这次还是C,不会再买入,不过可能卖出填补不足的钱或者股数大于10000
            if dp[i - 1]['C'][1] + change[i] >= 0 and dp[i - 1]['C'][0] + hold[i]['C'] <= 10000:
                share1, money1 = dp[i - 1]['C']
                money1 += change[i]
                log1 = log[i - 1]['C']
            else:
                if Sell(dp[i - 1]['C'], C[i]) + change[i] < 0: # 无论如何填补不了
                    share1, money1 = dp[i]['V']
                    log1 = log[i]['V']
                else:
                    needToSell = max(dp[i - 1]['C'][0] + hold[i]['C'] - 10000, 0, SellToGet(-(dp[i - 1]['C'][1] + change[i]), C[i])) # 需要卖的部分
                    if needToSell > dp[i - 1]['C'][0]:
                        share1, money1 = dp[i]['V']
                        log1 = log[i]['V']
                    else:
                        share1, money1 = dp[i - 1]['C'][0] - needToSell, Sell([needToSell, dp[i - 1]['C'][1]], C[i]) + change[i]
                        log1 = log[i - 1]['C'] + [[i,'sell', 'C', needToSell]]

            # 上次是V，这次是C,直接用上面算好的V
            needToBuy = min(Buy(dp[i]['V'][1], C[i])[0], 10000 - hold[i]['C'])
            share2, money2 = BuySome(dp[i]['V'][1],C[i],needToBuy)
            log2 = log[i]['V'] + [[i,'buy', 'C', needToBuy]]

            # 比较
            if share1 > share2 or share1 == share2 and money1 > money2:
                dp[i]['C'] = [share1,money1]
                log[i]['C'] = log1
            else:
                dp[i]['C'] = [share2, money2]
                log[i]['C'] = log2

        trades = log[n-1]['V']
        signMap = {'buy':1,'sell':-1}
        trades.sort()
        # 交易合并
        result = MergeTrades(result,trades)

        # update change
        change = [0] * (n + 1)
        for trade in result: # [0, 'buy', 'C', 8]
            change[trade[0]] -= signMap[trade[1]] * stockMap[trade[2]][trade[0]] * trade[3] + Commission(stockMap[trade[2]][trade[0]] * trade[3])
        # print(change)
        # init dp
        dp = [{'A':[0,0],'B':[0,0],'C':[0,0],'V':[0,0]} for _ in range(n+1)]
        dp[-1]['V'][1] = 10000
        # update hold
        reverseTrades = result.copy()[::-1]
        hold[-1] = {'A': 0, 'B': 0, 'C': 0}
        for i in range(n):
            hold[i]['A'] = hold[i-1]['A']
            hold[i]['B'] = hold[i-1]['B']
            hold[i]['C'] = hold[i-1]['C']
            while reverseTrades and reverseTrades[-1][0] == i:
                trade = reverseTrades.pop()
                hold[i][trade[2]] += trade[3] * signMap[trade[1]]



        # init log
        log = [{'A':[],'B':[],'C':[],'V':[]} for _ in range(n+1)]


    normalA, normalB, normalC = [], [], []
    for trade in result: # [0, 'buy', 'C', 8]
        if trade[2] == 'A': normalA.append(trade)
        if trade[2] == 'B': normalB.append(trade)
        if trade[2] == 'C': normalC.append(trade)

    bestA = Calculate(A,'A')
    bestB = Calculate(B,'B')
    bestC = Calculate(C,'C')

    resultBox = []

    for cutPoint in range(300,500,5):

        preA = CutTradeTo(cutPoint,normalA.copy())
        preB = CutTradeTo(cutPoint,normalB.copy())
        preC = CutTradeTo(cutPoint,normalC.copy())

        postA = CutTradeFrom(cutPoint,bestA.copy())
        postB = CutTradeFrom(cutPoint,bestB.copy())
        postC = CutTradeFrom(cutPoint,bestC.copy())

        combinedResult = sorted( preA + preB + preC + postA + postB + postC, key = lambda x: [x[0],-ord(x[1][0])])

        resultBox.append(TestTrades(combinedResult))

    return max(resultBox)










    # logToReport(sorted(result, key = lambda x: [x[0],-ord(x[1][0])]))
    # logToReport(sorted(bestResult, key = lambda x: [x[0],-ord(x[1][0])]))

















































