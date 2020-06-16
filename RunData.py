import execjs
from main import run
import random

def getdata(id):
    def get_js():
        f = open("setup.js", 'r', encoding='UTF-8')
        line = f.readline()
        htmlstr = ''
        while line:
            htmlstr = htmlstr + line
            line = f.readline()
        return htmlstr


    jsstr = get_js()
    ctx = execjs.compile(jsstr)
    s = str(id)
    return(ctx.call('getPrice',s))

maxResult = [0,0]
while 1:
    i = random.randint(1,4294967296)
    inputData = getdata(i)
    result = run(inputData)
    if result > maxResult[1]: maxResult = [i,result]
    print(result,'i=',i,', Best: id=',maxResult[0],', Score=',maxResult[1])
