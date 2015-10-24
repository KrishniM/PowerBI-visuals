module powerbi.visuals {
    import SelectionManager = utility.SelectionManager;
    export interface LinkDatapoint {
        source: number;
        target: number;
        value: number;
    }
    export interface GraphData {
        linkList: LinkDatapoint[];
        nodeList: NodeDatapoint[];
        minNodeSize ? : number;
        maxNodeSize ? : number;
        minLinkSize ? : number;
        maxLinkSize ? : number;
        useImage: boolean;
        useShape: boolean;
        linkDistance: number;
        charge ? : number
    }
    export interface NodeDatapoint {
        index: number;
        label: string;
        x: number;
        y: number;
        group: number;
        image ? : string;
        shape: string;
        color: string;
        size: number;
        selector: SelectionId;
        //tooltipInfo?: TooltipDataItem[];
    }
    export interface GraphMetadata {
        valueIndex: number;
        sourceGroupIndex: number;
        targetGroupIndex: number;
        sourceSizeIndex: number;
        targetSizeIndex: number;
        sourceImageIndex: number;
        targetImageIndex: number;
    }
    export class Graph implements IVisual {
        public static capabilities: VisualCapabilities = {
            dataRoles: [{
                name: matrixRoleNames.rows,
                displayName: "Source Node",
                kind: VisualDataRoleKind.Grouping
            }, {
                name: matrixRoleNames.columns,
                displayName: "Target Node",
                kind: VisualDataRoleKind.Grouping
            }, {
                name: matrixRoleNames.values,
                displayName: "Node&Link Properties",
                kind: VisualDataRoleKind.Measure
            }],
            dataViewMappings: [{
                conditions: [{
                    'Rows': {
                        max: 0
                    },
                    'Columns': {
                        max: 0
                    },
                    'Values': {
                        min: 1
                    },
                    'Source Group': {
                        max: 1
                    },
                    'Target Group': {
                        max: 1
                    }
                }, {
                    'Rows': {
                        min: 1
                    },
                    'Columns': {
                        min: 0
                    },
                    'Values': {
                        min: 0
                    },
                    'Source Group': {
                        max: 1
                    },
                    'Target Group': {
                        max: 1
                    }
                }, {
                    'Rows': {
                        min: 0
                    },
                    'Columns': {
                        min: 1
                    },
                    'Values': {
                        min: 0
                    },
                    'Source Group': {
                        max: 1
                    },
                    'Target Group': {
                        max: 1
                    }
                }],
                matrix: {
                    rows: {
                        for: { in : 'Rows'
                        },
                        /* Explicitly override the server data reduction to make it appropriate for matrix. */
                        dataReductionAlgorithm: {
                            window: {
                                count: 100
                            }
                        }
                    },
                    columns: {
                        for: { in : 'Columns'
                        },
                        /* Explicitly override the server data reduction to make it appropriate for matrix. */
                        dataReductionAlgorithm: {
                            top: {
                                count: 100
                            }
                        }
                    },
                    values: {
                        for: { in : 'Values'
                        },
                        //select: [{ bind: { to: 'Source Group' } }]
                    }
                },
            }],
            objects: {
                general: {
                    displayName: data.createDisplayNameGetter('Visual_General'),
                    properties: {
                        formatString: {
                            type: {
                                formatting: {
                                    formatString: true
                                }
                            },
                        },
                    },
                },
                label: {
                    displayName: 'Label',
                    properties: {
                        fill: {
                            displayName: 'Fill',
                            type: {
                                fill: {
                                    solid: {
                                        color: true
                                    }
                                }
                            }
                        }
                    }
                },
                parameters: {
                    displayName: 'Parameters',
                    properties: {
                        distance: {
                            displayName: 'Distance',
                            type: {
                                numeric: true
                            }
                        },
                        charge: {
                            displayName: 'Charge',
                            type: {
                                numeric: true
                            }
                        }
                    },
                },
                symbol: {
                    displayName: 'Symbol',
                    properties: {
                        show: {
                            displayName: 'Show',
                            type: {
                                bool: true
                            }
                        }
                    },
                },
            }
        };

        private static VisualClassName = 'graph';
        private static Node: ClassAndSelector = {
            class: 'node',
            selector: '.node'
        };
        private static Link: ClassAndSelector = {
            class: 'link',
            selector: '.link'
        };

        private static nodeSizeRange = {
            min: 15,
            max: 30,
            delta: 15
        }

        private static imageSizeRange = {
            min: 50,
            max: 100,
            delta: 50
        }

        private static linkSizeRange = {
            min: 3,
            max: 10,
            delta: 7
        }
        private svg: D3.Selection;
        private mainGroupElement: D3.Selection;
        private centerText: D3.Selection;
        private colors: IDataColorPalette;
        private selectionManager: SelectionManager;
        private dataView: DataView;
        private indexList: GraphMetadata;
        private graphData: GraphData;

        public static converter(indexList: GraphMetadata, dataView: DataView, colors: IDataColorPalette): GraphData {
            var sourceList = dataView.matrix.rows.root.children;
            var targetList = dataView.matrix.columns.root.children;
            var values = dataView.matrix.valueSources;
            var useImage = false;
            var linkDistance = 50;
            var charge = -200;
            var useShape = false;
            if (dataView.metadata != null && dataView.metadata.objects != null) {
                var objects = dataView.metadata.objects;
                var parametersObj = objects['parameters'];
                if (parametersObj) {
                    if (parametersObj != null) {
                        if (parametersObj['distance'] != null) {
                            linkDistance = < number > parametersObj['distance'];
                        }
                        if (parametersObj['charge'] != null) {
                            charge = < number > parametersObj['charge'];
                        }
                    }
                }
                var symbolObj = objects['symbol'];
                if (symbolObj) {
                    if (symbolObj != null) {
                        if (symbolObj['show']) {
                            useShape = < boolean > symbolObj['show'];
                        }
                    }
                }
            }

            //var formatStringProp = <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'formatString' };
            //var categorySourceFormatString = valueFormatter.getFormatString(cat.source, formatStringProp);
            var nodeDataPoints = this.createNodePoints(sourceList, targetList, colors);

            var linkDataPoints = this.createLinkPoints(indexList, values, sourceList, targetList, nodeDataPoints, colors);
            if (indexList.targetImageIndex != -1 && indexList.sourceImageIndex != -1) {
                useImage = true;
            }
            var maxNodeValue = nodeDataPoints[0].size;
            var minNodeValue = nodeDataPoints[0].size;
            var maxLinkValue = linkDataPoints[0].value;
            var minLinkValue = linkDataPoints[0].value;
            if (indexList.sourceSizeIndex != -1 && indexList.targetSizeIndex != -1) {
                for (var i = 0; i < nodeDataPoints.length; i++) {
                    if (maxNodeValue < nodeDataPoints[i].size) {
                        maxNodeValue = nodeDataPoints[i].size;
                    }
                    if (minNodeValue > nodeDataPoints[i].size) {
                        minNodeValue = nodeDataPoints[i].size;
                    }
                }
            }
            for (var i = 0; i < linkDataPoints.length; i++) {
                if (maxLinkValue < linkDataPoints[i].value) {
                    maxLinkValue = linkDataPoints[i].value;
                }
                if (minLinkValue > linkDataPoints[i].value) {
                    minLinkValue = linkDataPoints[i].value;
                }
            }
            return {
                nodeList: nodeDataPoints,
                linkList: linkDataPoints,
                useImage: useImage,
                useShape: useShape,
                maxNodeSize: maxNodeValue,
                minNodeSize: minNodeValue,
                maxLinkSize: maxLinkValue,
                minLinkSize: minLinkValue,
                linkDistance: linkDistance,
                charge: charge
            };
        }

        private static createNodePoints(sourceList: DataViewTreeNode[], targetList: DataViewTreeNode[], colors: IDataColorPalette): NodeDatapoint[] {
            var nodeDataPoints: NodeDatapoint[] = [];
            var group = -1;
            for (var i = 0, len = sourceList.length; i < len; i++) {
                var exist = false;
                for (var j = 0; j < nodeDataPoints.length; j++) {
                    if (sourceList[i].value == nodeDataPoints[j].label) {
                        exist = true;
                        break;
                    }
                }
                if (exist == false) {
                    var index = nodeDataPoints.length;
                    //var formattedCategoryValue = valueFormatter.format(sourceList[i], categorySourceFormatString);
                    nodeDataPoints.push({
                        label: sourceList[i].value,
                        index: index,
                        group: index,
                        color: colors.getColorByIndex(index).value,
                        shape: 'circle',
                        size: 10,
                        x: 0,
                        y: 0,
                        selector: SelectionId.createWithId(sourceList[i].identity),
                    });
                }
            }
            for (var i = 0, len = targetList.length; i < len; i++) {
                var exist = false;
                for (var j = 0; j < nodeDataPoints.length; j++) {
                    if (targetList[i].value == nodeDataPoints[j].label) {
                        exist = true;
                        break;
                    }
                }
                if (exist == false) {
                    var index = nodeDataPoints.length;
                    nodeDataPoints.push({
                        label: targetList[i].value,
                        index: index,
                        group: index,
                        color: colors.getColorByIndex(index).value,
                        shape: 'circle',
                        size: 10,
                        x: 0,
                        y: 0,
                        selector: SelectionId.createWithId(targetList[i].identity),
                    });
                }
            }
            return nodeDataPoints;
        }

        public static createLinkPoints(indexList: GraphMetadata, valueSources: DataViewMetadataColumn[], sourceList: DataViewTreeNode[], targetList: DataViewTreeNode[], nodeDataPoints: NodeDatapoint[], colors: IDataColorPalette): LinkDatapoint[] {
            var shapes: string[] = ["circle", "cross", "diamond", "square", "triangle-up"];
            var shape = false;
            var image = false;
            for (var i = 0; i < valueSources.length; i++) {
                if (valueSources[i].displayName.toLowerCase() == "linkweight") {
                    indexList.valueIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "sourcegroup") {
                    indexList.sourceGroupIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "targetgroup") {
                    indexList.targetGroupIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "sourcesize") {
                    indexList.sourceSizeIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "targetsize") {
                    indexList.targetSizeIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "sourceimage") {
                    indexList.sourceImageIndex = i;
                    continue;
                }
                if (valueSources[i].displayName.toLowerCase() == "targetimage") {
                    indexList.targetImageIndex = i;
                    continue;
                }
            }
            var linkDataPoints: LinkDatapoint[] = [];
            for (var i = 0, len = sourceList.length; i < len; i++) {
                var thisRow = sourceList[i];
                var source = thisRow.value;
                for (var j = 0, len2 = targetList.length; j < len2; j++) {
                    var target = targetList[j].value;
                    var targetIndex = -1;
                    var sourceIndex = -1;
                    for (var k = 0; k < nodeDataPoints.length; k++) {
                        if (target === nodeDataPoints[k].label) {
                            targetIndex = k;
                            break;
                        }
                    }
                    for (var k = 0; k < nodeDataPoints.length; k++) {
                        if (source === nodeDataPoints[k].label) {
                            sourceIndex = k;
                            break;
                        }
                    }
                    var len3 = valueSources.length;
                    for (var k = 0; k < len3; k++) {
                        if (thisRow.values[j * len3 + k].value != null) {
                            var index = 0;
                            var thisValue = thisRow.values[j * len3 + k];
                            if (thisValue.valueSourceIndex != null) {
                                index = thisValue.valueSourceIndex;
                            }
                            if (indexList.valueIndex == index) {
                                var weight = Number(thisValue.value);
                                linkDataPoints.push({
                                    source: sourceIndex,
                                    target: targetIndex,
                                    value: weight,
                                });
                            }
                            if (indexList.sourceGroupIndex == index) {
                                var groupIndex = Number(thisValue.value);
                                nodeDataPoints[sourceIndex].group = groupIndex;
                                nodeDataPoints[sourceIndex].color = colors.getColorByIndex(groupIndex).value;
                                nodeDataPoints[sourceIndex].shape = shapes[groupIndex % 5];
                            }
                            if (indexList.targetGroupIndex == index) {
                                var groupIndex = Number(thisValue.value);
                                nodeDataPoints[targetIndex].group = groupIndex;
                                nodeDataPoints[targetIndex].color = colors.getColorByIndex(groupIndex).value;
                                nodeDataPoints[targetIndex].shape = shapes[groupIndex % 5];
                            }

                            if (indexList.sourceSizeIndex == index) {
                                var size = Number(thisValue.value);
                                nodeDataPoints[sourceIndex].size = size * size;
                            }

                            if (indexList.targetSizeIndex == index) {
                                var size = Number(thisValue.value);
                                nodeDataPoints[targetIndex].size = size * size;
                            }

                            if (indexList.sourceImageIndex == index) {
                                nodeDataPoints[sourceIndex].image = thisValue.value;
                            }

                            if (indexList.targetImageIndex == index) {
                                nodeDataPoints[targetIndex].image = thisValue.value;
                            }
                        }

                    }


                }
            }
            return linkDataPoints;
        }
        public init(options: VisualInitOptions): void {
            var element = options.element;
            this.selectionManager = new SelectionManager({
                hostServices: options.host
            });
            var svg = this.svg = d3.select(element.get(0))
                .append('svg')
                .classed(Graph.VisualClassName, true);

            this.colors = options.style.colorPalette.dataColors;
            this.mainGroupElement = svg.append('g');
            this.centerText = this.mainGroupElement.append('text');
        }

        public update(options: VisualUpdateOptions) {
            if (!options.dataViews || !options.dataViews[0]) return; // or clear the view, display an error, etc.
            var dataView = this.dataView = options.dataViews[0];
            this.indexList = {
                valueIndex: -1,
                sourceGroupIndex: -1,
                targetGroupIndex: -1,
                sourceSizeIndex: -1,
                targetSizeIndex: -1,
                sourceImageIndex: -1,
                targetImageIndex: -1
            };
            this.graphData = Graph.converter(this.indexList, dataView, this.colors);
            var duration = options.suppressAnimations ? 0 : AnimatorCommon.MinervaAnimationDuration;
            var viewport = options.viewport;

            this.render(this.graphData, viewport);

        }

        public render(graphData: GraphData, viewport: IViewport) {
            var colors = this.colors;
            var that = this;
            this.svg
                .attr({
                    'height': viewport.height,
                    'width': viewport.width
                });

            var width = viewport.width;
            var height = viewport.height;

            var mainGroup = this.mainGroupElement;

            var force = d3.layout.force()
                .charge(that.graphData.charge)
                .linkDistance(that.graphData.linkDistance)
                .size([width, height]);
            force
                .nodes(graphData.nodeList)
                .links(graphData.linkList)
                .start();

            var link = mainGroup.selectAll(".link")
                .data(graphData.linkList)

            link.enter().append("line")
                .attr("class", "link")
                .style({
                    "stroke-width": function(d) {
                        return that.getLinkSize(graphData, d.value);
                    },
                    'stroke-opacity': function(d) {
                        return that.getLinkGradient(graphData, d.value);
                    },
                    "stroke": 'grey'
                });

            if (graphData.useImage) {
                mainGroup.selectAll(".node").remove();
                var node = mainGroup.selectAll(".image")
                    .data(graphData.nodeList);
                node.enter().append("svg:image")
                    .attr("class", "image")
                    .attr("transform", function(d) {
                        var r = that.getImageSize(graphData, d.size);
                        return "translate(" + (d.x - r / 2) + "," + (d.y - r / 2) + ")";
                    })
                    .attr("xlink:href", function(d) {
                        return d.image;
                    })
                    .attr("width", function(d) {
                        return that.getImageSize(graphData, d.size);
                    })
                    .attr("height", function(d) {
                        return that.getImageSize(graphData, d.size);
                    })
                    .call(force.drag)
                    .append("title")
                    .text(function(d) {
                        return d.label;
                    });
            } else {
                mainGroup.selectAll(".image").remove();
                var node = mainGroup.selectAll(".node")
                    .data(graphData.nodeList);

                node.enter().append("path")
                    .attr("class", "node")
                    .attr("transform", function(d) {
                        return "translate(" + d.x + "," + d.y + ")";
                    })
                    .attr("d", d3.svg.symbol().size(function(d) {
                        var r = that.getNodeSize(graphData, d.size);
                        return r * r;
                    }).type(function(d) {
                        if (graphData.useShape) {
                            return d.shape;
                        } else {
                            return "circle";
                        }
                    }))
                    .style("fill", function(d) {
                        return colors.getColorByIndex(d.group).value;
                    })
                    .call(force.drag)
                    .append("title")
                    .text(function(d) {
                        return d.label;
                    });
            }

            force.on("tick", function() {
                link.attr("x1", function(d) {
                        return d.source.x;
                    })
                    .attr("y1", function(d) {
                        return d.source.y;
                    })
                    .attr("x2", function(d) {
                        return d.target.x;
                    })
                    .attr("y2", function(d) {
                        return d.target.y;
                    });

                if (graphData.useImage) {
                    node
                        .attr("transform", function(d) {
                            var r = that.getImageSize(graphData, d.size);
                            return "translate(" + (d.x - r / 2) + "," + (d.y - r / 2) + ")";
                        })
                        .attr("xlink:href", function(d) {
                            return d.image;
                        })
                        .attr("width", function(d) {
                            return that.getImageSize(graphData, d.size);
                        })
                        .attr("height", function(d) {
                            return that.getImageSize(graphData, d.size);
                        })
                } else {
                    node
                        .attr("transform", function(d) {
                            return "translate(" + d.x + "," + d.y + ")";
                        })
                        .attr("d", d3.svg.symbol().size(function(d) {
                            var r = that.getNodeSize(graphData, d.size);
                            return r * r;
                        }).type(function(d) {
                            if (graphData.useShape) {
                                return d.shape;
                            } else {
                                return "circle";
                            }
                        }))
                        .style("fill", function(d) {
                            return d.color;
                        });
                }
            });
            node.exit().remove();
            link.exit().remove();
            //TooltipManager.addTooltip(node, (tooltipEvent: TooltipEvent) => tooltipEvent.data.data.tooltipInfo);
        }
        private getNodeSize(graphData: GraphData, value: number) {
            if (graphData.maxNodeSize == graphData.minNodeSize) {
                return Graph.nodeSizeRange.min + Graph.nodeSizeRange.delta / 2;
            } else {
                return Graph.nodeSizeRange.min + (value - graphData.minNodeSize) * Graph.nodeSizeRange.delta / (graphData.maxNodeSize - graphData.minNodeSize);
            }
        }
        private getImageSize(graphData: GraphData, value: number) {
            if (graphData.maxNodeSize == graphData.minNodeSize) {
                return Graph.imageSizeRange.min + Graph.imageSizeRange.delta / 2;
            } else {
                return Graph.imageSizeRange.min + (value - graphData.minNodeSize) * Graph.imageSizeRange.delta / (graphData.maxNodeSize - graphData.minNodeSize);
            }
        }

        private getLinkSize(graphData: GraphData, value: number) {
            if (graphData.maxLinkSize == graphData.minLinkSize) {
                return Graph.linkSizeRange.min + Graph.linkSizeRange.delta / 2;
            } else {
                return Graph.linkSizeRange.min + (value - graphData.minLinkSize) * Graph.linkSizeRange.delta / (graphData.maxLinkSize - graphData.minLinkSize);
            }
        }
        private getLinkGradient(graphData: GraphData, value: number) {
                if (graphData.maxLinkSize == graphData.minLinkSize) {
                    return 0.5;
                } else {
                    return 0.2 + (value - graphData.minLinkSize) * 0.6 / (graphData.maxLinkSize - graphData.minLinkSize);
                }
            }
            // This extracts fill color of the label from the DataView
        private getLabelFill(dataView: DataView): Fill {
            if (dataView && dataView.metadata.objects) {
                var label = dataView.metadata.objects['label'];
                if (label) {
                    return <Fill > label['fill'];
                }
            }

            return {
                solid: {
                    color: '#333'
                }
            };
        }

        // This function retruns the values to be displayed in the property pane for each object.
        // Usually it is a bind pass of what the property pane gave you, but sometimes you may want to do
        // validation and return other values/defaults
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
            var instances: VisualObjectInstance[] = [];
            switch (options.objectName) {
                case 'label':
                    var label: VisualObjectInstance = {
                        objectName: 'label',
                        displayName: 'Label',
                        selector: null,
                        properties: {
                            fill: this.getLabelFill(this.dataView)
                        }
                    };
                    instances.push(label);
                    break;
                case 'parameters':
                    var linkDistace: VisualObjectInstance = {
                        objectName: 'parameters',
                        displayName: 'Parameters',
                        selector: null,
                        properties: {
                            distance: this.graphData.linkDistance
                        }
                    };
                    var charge: VisualObjectInstance = {
                        objectName: 'parameters',
                        displayName: 'Parameters',
                        selector: null,
                        properties: {
                            charge: this.graphData.charge
                        }
                    };
                    instances.push(linkDistace);
                    instances.push(charge);
                    break;
                case 'symbol':
                    var symbol: VisualObjectInstance = {
                        objectName: 'symbol',
                        displayName: 'Symbol',
                        selector: null,
                        properties: {
                            show: this.graphData.useShape
                        }
                    };
                    instances.push(symbol);
                    break;
            }

            return instances;
        }
    }
}