# -*- coding: UTF-8 -*-
from pandas import read_csv
import math

cs = read_csv("prices.csv",header=0)
A = cs.values[0:,1:2]
A = [x[0] for x in A]
B = cs.values[0:,2:3]
B = [x[0] for x in B]
C = cs.values[0:,3:4]
C = [x[0] for x in C]

n = 512
money = 10000

def Commission(cost):
    return int(math.ceil(cost*0.05))

def SimpleSell(share,restMoney,price):
    return int(price * share + restMoney - Commission(price * share))

def SimpleBuy(share,totalMoney,price):
    return int(totalMoney - price * share - Commission(price * share))

def Calculate(X):
    dp = [[0,0] for _ in range(n)] # 不持有的金额 和 持有10000股的剩下的金额
    dp[-1][1] = -999999999
    log = [{'V':[],'H':[]} for _ in range(n)]
    for i in range(n):
        dp[i][0] = max(dp[i-1][0],SimpleSell(10000,dp[i-1][1],X[i]))
        if dp[i][0] == dp[i-1][0]: log[i]['V'] = log[i-1]['V']
        else: log[i]['V'] = log[i-1]['H'] + [[i,'sell', 10000]]
        dp[i][1] = max(dp[i-1][1],SimpleBuy(10000,dp[i][0],X[i]))
        if dp[i][1] == dp[i-1][1]: log[i]['H'] = log[i-1]['H']
        else: log[i]['H'] = log[i]['V'] + [[i,'buy', 10000]]
    return log[n-1]['V']

print(Calculate(A))







































