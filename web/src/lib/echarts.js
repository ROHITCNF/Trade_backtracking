// ECharts with only the pieces the app draws (D5): modular imports keep the
// bundle small.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, AxisPointerComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, MarkLineComponent, AxisPointerComponent, LegendComponent, CanvasRenderer]);

export default echarts;
