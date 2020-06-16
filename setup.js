
function getPrice(currentSeed) {

    var numStocks =  3;
    var endTime =  512;
    var volatility =  0.059;
    var meanReversionYield = 2.0;
    var meanReversionFactor = 0.05;

    var rand = seed(currentSeed);
        quotes = [];

        for (var s = 0; s < numStocks; s++) {
            var prices = [];
            var price = 1000;
            var targetPrice = meanReversionYield * price;

            for (var t = 0; t < endTime; t++) {
                var mean = meanReversionFactor * Math.log(targetPrice / price);
                price *= Math.exp(mean + volatility * norminv(rand()));
                prices.push(Math.round(price));
            }

            quotes[s] = prices;
        }
    return quotes;
}

function seed(s) {
    var m_w  = s;
    var m_z  = 987654321;
    var mask = 0xffffffff;

        return function() {
            m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
            m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;

            var result = ((m_z << 16) + m_w) & mask;
            result /= 4294967296;
            result += 0.5;

            if (result >= 1.0) {
                result -= 1.0;
            }

            return result;
        };
    }

function norminv(p) {
        var a1 = -39.6968302866538, a2 = 220.946098424521, a3 = -275.928510446969;
        var a4 = 138.357751867269, a5 = -30.6647980661472, a6 = 2.50662827745924;
        var b1 = -54.4760987982241, b2 = 161.585836858041, b3 = -155.698979859887;
        var b4 = 66.8013118877197, b5 = -13.2806815528857;
        var c1 = -7.78489400243029E-03, c2 = -0.322396458041136, c3 = -2.40075827716184;
        var c4 = -2.54973253934373, c5 = 4.37466414146497, c6 = 2.93816398269878;
        var d1 = 7.78469570904146E-03, d2 = 0.32246712907004, d3 = 2.445134137143;
        var d4 = 3.75440866190742;
        var p_low = 0.02425, p_high = 1 - p_low;
        var q, r;
        var retVal;

        if ((p < 0) || (p > 1)) {
            retVal = 0;
        } else if (p < p_low) {
            q = Math.sqrt(-2 * Math.log(p));
            retVal = (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        } else if (p <= p_high) {
            q = p - 0.5;
            r = q * q;
            retVal = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
        } else {
            q = Math.sqrt(-2 * Math.log(1 - p));
            retVal = -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        }

        return retVal;
    }