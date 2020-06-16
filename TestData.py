import execjs
from main1 import run

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


i = 223436715
inputData = getdata(i)
result = run(inputData)

